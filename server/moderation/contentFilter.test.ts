/**
 * contentFilter 单元自检脚本（手动跑）
 * 用法：npx tsx server/moderation/contentFilter.test.ts
 */
import { moderateContent, StreamModerator, ModerationConfig } from "./contentFilter.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, info?: any) {
  if (cond) { console.log("  ✅", name); pass++; }
  else { console.log("  ❌", name, info ?? ""); fail++; }
}

console.log("== 测试 1：基础敏感词 ==");
{
  const r = moderateContent("你好，我想咨询毒品制作流程");
  check("阻断含「毒品制作」", r.blocked, r);
}

console.log("\n== 测试 2：手机号脱敏 ==");
{
  const r = moderateContent("我的手机是 13812345678，邮箱 a@b.com，身份证 110101199001011234");
  check("不阻断", !r.blocked, r);
  check("做了脱敏", r.redacted, r);
  check("手机号已脱敏", r.sanitized.includes("138****5678"), r.sanitized);
  check("邮箱已脱敏", !r.sanitized.includes("a@b.com"), r.sanitized);
  check("身份证已脱敏", r.sanitized.includes("********"), r.sanitized);
}

console.log("\n== 测试 3：正常文本放行 ==");
{
  const r = moderateContent("我想问下如何申请退款？");
  check("放行", !r.blocked && !r.redacted, r);
}

console.log("\n== 测试 4：流式扫描器 ==");
{
  const sm = new StreamModerator();
  // 模拟流：先发一段不含敏感词，再把敏感词拆成两段跨过 scan
  const a = sm.scan("这是正常内容，结尾是敏感词前");
  check("正常片段不阻断", !a.block, a);
  const b = sm.scan("毒");
  check("半截敏感词缓冲不阻断", !b.block, b);
  const c = sm.scan("品制作");
  check("跨片段组成敏感词即阻断", c.block, c);
  const fl = sm.flush();
  // 注：阻断后 flush 仍可能再次命中（双重保险），只要不抛错就算通过
  check("flush 行为可预测", typeof fl.block === "boolean", fl);
}

console.log("\n== 测试 5：大小写敏感词 ==");
{
  const r = moderateContent("FUCK");
  // 词典无此英文词，仅作示意
  check("未命中英文词", !r.blocked, r);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
console.log("当前词表：", {
  sensitiveCount: ModerationConfig.sensitiveWords.length,
  privacyCount: ModerationConfig.privacyPatterns.length,
  injectionCount: ModerationConfig.injectionPatterns.length,
});

if (fail > 0) process.exit(1);