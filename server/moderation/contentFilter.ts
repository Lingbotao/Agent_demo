/**
 * 内容安全过滤模块
 *
 * 覆盖三类检查：
 *  1) 敏感词（politics / violence / porn / 自定义）→ 命中后阻断
 *  2) 隐私信息（手机号 / 身份证 / 银行卡 / 邮箱）→ 命中后脱敏
 *  3) 注入风险提示（提示词注入关键词）→ 仅警告，不阻断
 *
 * 设计原则：
 *  - 与 LangChain / LLM Provider 解耦，可作为输入/输出的纯函数中间件使用
 *  - 输入端：阻断类命中直接返回错误，让路由层处理；脱敏类原地改写
 *  - 输出端：流式回调按"累计缓冲 → 滑动窗口"扫，避免半截敏感词被漏判
 *  - 配置集中、可扩展：词表与正则都通过常量追加
 */

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

// ============= 类型 =============

export interface ModerationResult {
  /** 是否阻断（敏感词命中即视为不安全） */
  blocked: boolean;
  /** 是否做了脱敏 */
  redacted: boolean;
  /** 过滤后的内容（脱敏后版本） */
  sanitized: string;
  /** 命中的原因列表（敏感词 / 隐私） */
  reasons: string[];
}

export interface StreamScanResult {
  /** 是否阻断整段流 */
  block: boolean;
  /** 阻断原因（若 block） */
  reason?: string;
  /** 是否需要对本片段做脱敏 */
  redactedText?: string;
}

// ============= 敏感词词表 =============

/**
 * 敏感词词典（默认基础版）
 * 注意：这是演示项目的轻量词表，生产环境建议接入专业审核 API（阿里云 / 腾讯云 / OpenAI moderation）
 */
const SENSITIVE_WORDS: string[] = [
  // 政治相关（演示占位）
  "法轮功", "反动", "颠覆国家", "台独", "港独",
  // 暴力
  "恐怖袭击", "自杀方法", "教你杀人",
  // 色情
  "色情", "裸聊", "约炮",
  // 辱骂（示例）
  "傻逼", "操你妈", "草泥马",
  // 违法犯罪
  "毒品制作", "枪支贩卖", "假证办理",
];

/** 注入风险关键词（命中仅警告，不阻断） */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /忽略(以上|之前|所有)(指令|提示)/,
  /system\s*:/i,
];

// ============= 隐私信息正则 =============

const PRIVACY_PATTERNS: Array<{ name: string; regex: RegExp; mask: (match: string) => string }> = [
  {
    // 中国大陆手机号
    name: "手机号",
    regex: /\b1[3-9]\d{9}\b/g,
    mask: (m) => m.slice(0, 3) + "****" + m.slice(7),
  },
  {
    // 18 位身份证号（含末尾 X/x）
    name: "身份证号",
    regex: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    mask: (m) => m.slice(0, 6) + "********" + m.slice(14),
  },
  {
    // 银行卡号（16-19 位数字）
    name: "银行卡号",
    regex: /\b\d{16,19}\b/g,
    mask: (m) => m.slice(0, 4) + " **** **** " + m.slice(-4),
  },
  {
    // 邮箱
    name: "邮箱",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    mask: (m) => {
      const [user, domain] = m.split("@");
      const maskedUser = user.length <= 2 ? user[0] + "*" : user[0] + "***" + user.slice(-1);
      return `${maskedUser}@${domain}`;
    },
  },
];

// ============= 核心实现 =============

/**
 * 检查一段文本：
 *  - 命中敏感词 → 阻断（blocked=true）
 *  - 命中隐私正则 → 脱敏（redacted=true）
 *  - 命中注入关键词 → 不阻断，仅在 reasons 中加入"注入风险"
 */
export function moderateContent(text: string): ModerationResult {
  const reasons: string[] = [];
  let sanitized = text ?? "";
  let blocked = false;
  let redacted = false;

  // 1) 敏感词扫描（不区分大小写）
  const lower = sanitized.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      blocked = true;
      reasons.push(`敏感词: ${word}`);
    }
  }

  // 2) 注入风险提示（不阻断）
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      reasons.push("检测到提示词注入风险");
      break;
    }
  }

  // 3) 隐私信息脱敏（即便被阻断也跑一次，得到脱敏版本便于兜底返回）
  for (const { name, regex, mask } of PRIVACY_PATTERNS) {
    const before = sanitized;
    sanitized = sanitized.replace(regex, (m) => {
      reasons.push(`隐私信息: ${name}`);
      return mask(m);
    });
    if (sanitized !== before) redacted = true;
  }

  return { blocked, redacted, sanitized, reasons: dedup(reasons) };
}

/** 输出端流式扫描（用于 SSE 文本回调） */
export class StreamModerator {
  private buffer = "";
  private readonly SAFE_TAIL: number; // 滑动窗口的最大单词/字符长度

  constructor() {
    // 取最长敏感词 + 留余量，确保跨片段拼接也能命中
    const maxLen = Math.max(...SENSITIVE_WORDS.map((w) => w.length), 16);
    this.SAFE_TAIL = maxLen;
  }

  /**
   * 扫描一个文本片段，返回"可立即安全发送的部分"与"是否需要阻断"
   * 算法：保留 buffer 末尾 SAFE_TAIL 个字符不输出（避免半截敏感词）
   */
  scan(chunk: string): StreamScanResult {
    if (!chunk) return { block: false };

    this.buffer += chunk;

    // 1) 阻断：只要 buffer 命中完整敏感词就阻断
    const lowerBuffer = this.buffer.toLowerCase();
    for (const word of SENSITIVE_WORDS) {
      if (lowerBuffer.includes(word.toLowerCase())) {
        return { block: true, reason: `敏感词: ${word}` };
      }
    }

    // 2) 脱敏：能立即输出的部分（去掉最后 SAFE_TAIL 个字符当作待定缓冲）
    let safeToEmit = this.buffer;
    if (this.buffer.length > this.SAFE_TAIL) {
      safeToEmit = this.buffer.slice(0, this.buffer.length - this.SAFE_TAIL);
      this.buffer = this.buffer.slice(this.buffer.length - this.SAFE_TAIL);
    } else {
      safeToEmit = "";
    }

    if (!safeToEmit) return { block: false };

    // 在可安全部分做隐私脱敏
    let redacted = false;
    for (const { regex, mask } of PRIVACY_PATTERNS) {
      safeToEmit = safeToEmit.replace(regex, (m) => {
        redacted = true;
        return mask(m);
      });
    }

    return redacted ? { block: false, redactedText: safeToEmit } : { block: false };
  }

  /** 流结束时 flush 残余 buffer（最后一块一次性扫） */
  flush(): StreamScanResult {
    if (!this.buffer) return { block: false };
    const tail = this.buffer;
    this.buffer = "";
    const res = moderateContent(tail);
    if (res.blocked) return { block: true, reason: res.reasons.join("; ") };
    if (res.redacted) return { block: false, redactedText: res.sanitized };
    return { block: false };
  }
}

// ============= LangChain 消息适配（可选便捷方法） =============

/**
 * 对 LangChain 消息数组做输入侧过滤
 *  - 任意 HumanMessage 命中敏感词 → 抛错（阻断）
 *  - SystemMessage / AIMessage 一律做脱敏处理
 */
export function moderateMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((m) => {
    const text = messageContent(m);
    if (!text) return m;

    if (m instanceof HumanMessage) {
      const r = moderateContent(text);
      if (r.blocked) {
        throw new Error(`输入内容包含敏感词，已被拦截: ${r.reasons.join("; ")}`);
      }
      // 即便不阻断，也做隐私脱敏
      if (r.redacted) {
        return new HumanMessage(r.sanitized);
      }
      return m;
    }

    if (m instanceof AIMessage || m instanceof SystemMessage) {
      const r = moderateContent(text);
      if (r.redacted) {
        if (m instanceof AIMessage) return new AIMessage(r.sanitized);
        return new SystemMessage(r.sanitized);
      }
      return m;
    }

    return m;
  });
}

function messageContent(m: BaseMessage): string {
  const c: any = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b: any) => (typeof b === "string" ? b : b?.text || ""))
      .join("");
  }
  return "";
}

function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// ============= 对外暴露词表（方便外部按需扩展 / 测试） =============
export const ModerationConfig = {
  sensitiveWords: SENSITIVE_WORDS,
  privacyPatterns: PRIVACY_PATTERNS.map(({ name, regex }) => ({ name, regex })),
  injectionPatterns: INJECTION_PATTERNS,
};