/**
 * FAQ 知识库加载器
 * 负责初始化和加载 FAQ 数据
 */

import * as db from '../db.js';
import { getVectorStore } from './vectorStore.js';

/** 预设 FAQ 数据 */
const DEFAULT_FAQS: Array<{
  question: string;
  answer: string;
  category: string;
  keywords: string;
}> = [
  // ===== 退款类 =====
  {
    question: '如何申请退款？',
    answer: '您好！申请退款的步骤如下：\n1. 登录您的账户，进入"我的订单"\n2. 找到需要退款的订单，点击"申请退款"\n3. 选择退款原因并提交\n4. 我们会在 1-3 个工作日内审核\n5. 审核通过后，款项将在 3-7 个工作日内原路返回\n\n如果订单已发货，请先拒收或退货后再申请。',
    category: 'refund',
    keywords: '退款 申请 流程 步骤 怎么退',
  },
  {
    question: '退款多久到账？',
    answer: '退款到账时间取决于支付方式：\n- 微信/支付宝：审核通过后 1-3 个工作日\n- 银行卡：审核通过后 3-7 个工作日\n- 信用卡：审核通过后 5-15 个工作日\n\n如超过上述时间仍未到账，请联系客服并提供退款单号。',
    category: 'refund',
    keywords: '退款 到账 时间 多久 到账时间',
  },
  {
    question: '退款需要什么条件？',
    answer: '退款条件如下：\n- 未发货订单：可随时申请退款\n- 已发货未签收：需先拒收，物流退回后处理退款\n- 已签收：需在签收后 7 天内申请，商品需保持完好\n- 虚拟商品/定制商品：一经发货不支持退款\n\n部分特殊商品（如食品、内衣等）不支持无理由退款，请确认商品详情页的退换政策。',
    category: 'refund',
    keywords: '退款 条件 要求 政策 退换',
  },
  {
    question: '退款被拒绝了怎么办？',
    answer: '如果您的退款申请被拒绝，您可以：\n1. 查看拒绝原因（在订单详情页可见）\n2. 确认是否符合退款条件\n3. 如有异议，可在订单详情页点击"申诉"\n4. 提供更多证据（如商品照片）\n5. 客服会在 24 小时内处理申诉\n\n如仍有疑问，可以选择转接人工客服处理。',
    category: 'refund',
    keywords: '退款 拒绝 申诉 驳回 不通过',
  },

  // ===== 订单查询类 =====
  {
    question: '如何查询我的订单？',
    answer: '查询订单的方法：\n1. 登录账户后进入"我的订单"页面\n2. 可通过订单号、商品名称、下单时间进行搜索\n3. 支持按订单状态筛选：待付款/待发货/待收货/已完成\n4. 点击订单可查看详细信息，包括物流追踪\n\n如找不到订单，请确认登录的是正确的账户。',
    category: 'order_inquiry',
    keywords: '订单 查询 查看 查找 我的订单',
  },
  {
    question: '订单物流怎么查？',
    answer: '查询物流信息：\n1. 进入"我的订单"，找到对应订单\n2. 点击"查看物流"按钮\n3. 可以看到实时物流轨迹和预计送达时间\n4. 也可复制快递单号到快递公司官网查询\n\n如物流信息超过 24 小时未更新，请联系客服核查。',
    category: 'order_inquiry',
    keywords: '物流 快递 配送 发货 追踪 物流查询',
  },
  {
    question: '订单多久发货？',
    answer: '发货时效说明：\n- 现货商品：下单后 24-48 小时内发货\n- 预售商品：以商品页面标注的发货时间为准\n- 定制商品：以商家沟通确认的时间为准\n- 节假日期间的订单可能会顺延\n\n如超过承诺发货时间仍未发货，您可以申请退款或联系客服催促。',
    category: 'order_inquiry',
    keywords: '发货 多久 时间 配送 什么时候发',
  },
  {
    question: '可以修改订单地址吗？',
    answer: '修改收货地址：\n- 未发货订单：可在订单详情页直接修改地址\n- 已发货订单：无法直接修改，建议联系快递公司转寄\n- 如快递公司不支持转寄，请联系客服协助处理\n\n注意：修改地址可能导致配送时间延长。',
    category: 'order_inquiry',
    keywords: '地址 修改 改地址 收货 收货地址',
  },

  // ===== 技术支持类 =====
  {
    question: 'App 无法登录怎么办？',
    answer: 'App 登录问题排查步骤：\n1. 检查网络连接是否正常（切换 WiFi/4G 试试）\n2. 确认账号密码是否正确（区分大小写）\n3. 尝试"忘记密码"重置密码\n4. 清除 App 缓存后重试\n5. 检查 App 是否为最新版本\n6. 如使用第三方登录（微信/QQ），确认授权是否过期\n\n如以上方法均无效，请联系技术支持。',
    category: 'tech_support',
    keywords: '登录 无法登录 账号 密码 登不上',
  },
  {
    question: '支付失败怎么处理？',
    answer: '支付失败常见原因及解决方法：\n1. 余额不足：请确认支付账户余额充足\n2. 银行卡限额：部分银行卡有单笔/日累计限额\n3. 网络问题：切换网络后重试\n4. 支付方式受限：尝试更换其他支付方式\n5. 系统繁忙：稍后再试\n\n如多次尝试仍失败，请记录错误提示信息并联系客服。',
    category: 'tech_support',
    keywords: '支付 失败 无法支付 付款 支付不了',
  },
  {
    question: '页面显示异常或乱码？',
    answer: '页面显示异常处理方法：\n1. 刷新页面或重启 App\n2. 清除浏览器缓存和 Cookie\n3. 更换浏览器（推荐 Chrome/Edge 最新版）\n4. 检查系统字体设置\n5. 更新 App 至最新版本\n\n如问题持续存在，请截图并提供设备型号和系统版本信息。',
    category: 'tech_support',
    keywords: '显示 乱码 异常 加载 页面 错误',
  },
  {
    question: '收不到验证码怎么办？',
    answer: '验证码问题排查：\n1. 确认手机号是否正确\n2. 检查是否被手机安全软件拦截\n3. 查看短信收件箱是否已满\n4. 等待 60 秒后重新获取\n5. 尝试语音验证码（如支持）\n6. 检查手机信号是否正常\n\n每日获取验证码上限为 10 次，超过后需等待次日。',
    category: 'tech_support',
    keywords: '验证码 短信 收不到 验证 手机',
  },

  // ===== 通用类 =====
  {
    question: '客服工作时间是什么？',
    answer: '我们的客服服务时间：\n- 在线客服：每天 9:00 - 22:00\n- 电话客服：工作日 9:00 - 18:00\n- 智能客服：7×24 小时在线\n\n非工作时间的问题将在次日优先处理。紧急问题请致电：400-XXX-XXXX。',
    category: 'general',
    keywords: '客服 时间 工作时间 联系 电话',
  },
  {
    question: '如何联系人工客服？',
    answer: '联系人工客服的方式：\n1. 在对话框中说"转人工"或"人工客服"\n2. 拨打客服热线：400-XXX-XXXX\n3. 发送邮件至：support@example.com\n4. 关注微信公众号"XX客服"在线咨询\n\n人工客服工作时间：工作日 9:00-18:00，节假日可能有所调整。',
    category: 'general',
    keywords: '人工 客服 转人工 联系 电话',
  },
];

/** 初始化 FAQ 知识库（仅在表为空时） */
export async function initializeFaqKnowledge(): Promise<{ loaded: number; total: number }> {
  const existingCount = db.getFaqCount();
  
  if (existingCount > 0) {
    console.log(`[FAQ] 知识库已存在 ${existingCount} 条数据，跳过初始化`);
    await getVectorStore().reload();
    return { loaded: 0, total: existingCount };
  }

  console.log('[FAQ] 开始初始化知识库...');
  let loaded = 0;

  const insertMany = db.createFaq;
  for (const faq of DEFAULT_FAQS) {
    try {
      insertMany({
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        keywords: faq.keywords,
      });
      loaded++;
    } catch (e) {
      console.error(`[FAQ] 插入失败: ${faq.question}`, e);
    }
  }

  // 重新加载向量存储（生成 embedding 并建索引）
  await getVectorStore().reload();

  console.log(`[FAQ] 初始化完成，加载 ${loaded}/${DEFAULT_FAQS.length} 条数据`);
  return { loaded, total: DEFAULT_FAQS.length };
}

/** 向知识库添加单条 FAQ */
export async function addFaq(question: string, answer: string, category: string, keywords?: string): Promise<db.FaqKnowledge> {
  const faq = db.createFaq({ question, answer, category, keywords: keywords ?? null });
  await getVectorStore().addEntry(faq);
  return faq;
}

/** 更新 FAQ 条目 */
export async function replaceFaq(
  id: string,
  updates: { question?: string; answer?: string; category?: string; keywords?: string | null }
): Promise<db.FaqKnowledge | undefined> {
  // 仅向 db.updateFaq 传入"实际被显式提供"的字段，避免 undefined 覆盖原值
  const partial: Parameters<typeof db.updateFaq>[1] = {};
  if (updates.question !== undefined) partial.question = updates.question;
  if (updates.answer !== undefined) partial.answer = updates.answer;
  if (updates.category !== undefined) partial.category = updates.category;
  // keywords 允许显式传 null（清空），但未提供时不应覆盖
  if (updates.keywords !== undefined) partial.keywords = updates.keywords ?? undefined;

  const updated = db.updateFaq(id, partial);
  if (!updated) return undefined;

  const store = getVectorStore();
  // 旧向量先移除，再用新文本重建
  await store.removeEntry(id);
  await store.addEntry(updated);
  return updated;
}

/** 从知识库删除 FAQ */
export async function removeFaq(id: string): Promise<boolean> {
  const success = db.deleteFaq(id);
  if (success) {
    await getVectorStore().removeEntry(id);
  }
  return success;
}
