/**
 * FAQ 知识库管理页
 *
 * 功能：
 *  - 列表展示 / 分类筛选 / 关键词搜索
 *  - 新增 / 编辑 / 删除 FAQ
 *  - 变更通过后端 API 实时同步向量库（addEntry / removeEntry）
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Dialog,
  Input,
  Loading,
  MessagePlugin,
  Select,
  Table,
  Tag,
} from 'tdesign-react';
import { Pencil, Plus, Trash2, Search } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { FaqEditForm } from '../components/FaqEditForm';

const API_BASE = '/api/admin';

interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '退款', value: 'refund' },
  { label: '订单查询', value: 'order_inquiry' },
  { label: '技术支持', value: 'tech_support' },
  { label: '通用咨询', value: 'general' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

const CATEGORY_THEME: Record<string, 'danger' | 'primary' | 'warning' | 'success'> = {
  refund: 'danger',
  order_inquiry: 'primary',
  tech_support: 'warning',
  general: 'success',
};

export default function FaqManagePage() {
  const { authHeader } = useAuth();

  const [faqs, setFaqs] = useState<Faq[]>([]);
  /** 后端返回的 total（即使列表为空也代表真实总数） */
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [editing, setEditing] = useState<Faq | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Faq | null>(null);
  const [form, setForm] = useState({
    question: '',
    answer: '',
    category: 'general',
    keywords: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchFaqs = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/faq`, { headers: { ...authHeader() } });
      // HTTP 非 2xx：保留旧数据，不把列表清空
      if (!res.ok) {
        MessagePlugin.error(`获取 FAQ 失败（HTTP ${res.status}）`);
        return;
      }
      const data = await res.json();
      if (data.error) {
        MessagePlugin.error(data.error);
        return;
      }
      setFaqs(data.faqs || []);
      if (typeof data.total === 'number') {
        setTotal(data.total);
      }
    } catch {
      MessagePlugin.error('获取 FAQ 失败');
      // 网络异常也保留旧数据，避免标签瞬间变 0
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFaqs();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return faqs.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (!kw) return true;
      return (
        f.question.toLowerCase().includes(kw) ||
        (f.keywords || '').toLowerCase().includes(kw) ||
        f.answer.toLowerCase().includes(kw)
      );
    });
  }, [faqs, keyword, categoryFilter]);

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({ question: '', answer: '', category: 'general', keywords: '' });
  };

  const openEdit = (f: Faq) => {
    setCreating(false);
    setEditing(f);
    setForm({
      question: f.question,
      answer: f.answer,
      category: f.category,
      keywords: f.keywords || '',
    });
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
  };

  const submit = async () => {
    if (!form.question.trim() || !form.answer.trim() || !form.category) {
      MessagePlugin.warning('请填写问题、答案和分类');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category,
        keywords: form.keywords.trim() || null,
    };
    if (editing) {
      const res = await fetch(`${API_BASE}/faq/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        MessagePlugin.error(data.error || '更新失败');
        return;
      }
      MessagePlugin.success('已更新并同步向量库');
    } else {
      const res = await fetch(`${API_BASE}/faq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        MessagePlugin.error(data.error || '创建失败');
        return;
      }
      MessagePlugin.success('已新增并写入向量库');
    }
    closeDialog();
    await fetchFaqs();
  } catch {
    MessagePlugin.error('操作失败，请重试');
  } finally {
    setSubmitting(false);
  }
};

  const askDelete = (f: Faq) => {
    // TDesign 的 DialogPlugin.confirm 不返回 Promise，
    // 只返回一个 dialogNode 对象，立即就是 truthy，
    // await 它等于"不等任何东西"——这就是删除按钮没等确认就直接删除的根因。
    // 改用受控 Dialog + state 显式控制，用户点确认按钮才真正发请求。
    setPendingDelete(f);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const f = pendingDelete;
    setPendingDelete(null);
    try {
      const res = await fetch(`${API_BASE}/faq/${f.id}`, {
        method: 'DELETE',
        headers: { ...authHeader() },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        MessagePlugin.error(data.error || '删除失败');
        return;
      }
      MessagePlugin.success('已删除');
      await fetchFaqs();
    } catch {
      MessagePlugin.error('删除失败');
    }
  };

  const dialogVisible = creating || !!editing;

  return (
    <div className="p-6 overflow-auto h-full">
      <Card
        title={
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--td-text-color-primary)' }}>📚 FAQ 知识库管理</span>
          </div>
        }
        bordered
        actions={
          <Button theme="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新增 FAQ
          </Button>
        }
      >
        {/* 过滤区 */}
        <div className="flex items-center gap-3 mb-4">
          <Input
            value={keyword}
            onChange={(v) => setKeyword(v)}
            placeholder="搜索问题 / 关键词 / 答案"
            prefixIcon={<Search size={14} />}
            clearable
            style={{ width: 280 }}
          />
          <Select
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v as string)}
            style={{ width: 180 }}
            options={[{ label: '全部分类', value: 'all' }, ...CATEGORY_OPTIONS]}
          />
          <Button variant="outline" onClick={fetchFaqs}>刷新</Button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loading text="加载中..." />
          </div>
        ) : (
          <Table
            data={filtered}
            rowKey="id"
            hover
            stripe
            pagination={{
              defaultPageSize: 10,
              pageSizeOptions: [10, 20, 50],
              total: filtered.length,
              // TDesign 默认 totalContent=true 显示"共 X 条"
              showJumper: true,
            }}
            columns={[
              {
                colKey: 'question',
                title: '问题',
                minWidth: 240,
                ellipsis: true,
                cell: ({ row }: any) => (
                  <span style={{ fontWeight: 500 }}>{row.question}</span>
                ),
              },
              {
                colKey: 'category',
                title: '分类',
                width: 110,
                cell: ({ row }: any) => (
                  <Tag theme={CATEGORY_THEME[row.category] || 'default'} variant="dark">
                    {CATEGORY_LABEL[row.category] || row.category}
                  </Tag>
                ),
              },
              {
                colKey: 'keywords',
                title: '关键词',
                minWidth: 160,
                ellipsis: true,
                cell: ({ row }: any) =>
                  row.keywords ? (
                    <span style={{ color: 'var(--td-text-color-secondary)' }}>{row.keywords}</span>
                  ) : (
                    <span style={{ color: 'var(--td-text-color-placeholder)' }}>—</span>
                  ),
              },
              {
                colKey: 'answer',
                title: '答案预览',
                minWidth: 240,
                ellipsis: true,
                cell: ({ row }: any) => (
                  <span style={{ color: 'var(--td-text-color-secondary)' }}>
                    {row.answer.replace(/\n/g, ' ').slice(0, 80)}
                    {row.answer.length > 80 ? '…' : ''}
                  </span>
                ),
              },
              {
                colKey: 'updated_at',
                title: '更新时间',
                width: 170,
                cell: ({ row }: any) => new Date(row.updated_at).toLocaleString('zh-CN'),
              },
              {
                colKey: 'action',
                title: '操作',
                width: 160,
                fixed: 'right',
                cell: ({ row }: any) => (
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      theme="primary"
                      variant="outline"
                      icon={<Pencil size={12} />}
                      onClick={() => openEdit(row)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      theme="danger"
                      variant="outline"
                      icon={<Trash2 size={12} />}
                      onClick={() => askDelete(row)}
                    >
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
            empty="暂无 FAQ"
          />
        )}
      </Card>

      {/* 新增 / 编辑弹窗 */}
      <Dialog
        header={editing ? '编辑 FAQ' : '新增 FAQ'}
        visible={dialogVisible}
        onClose={closeDialog}
        onConfirm={submit}
        width={680}
        confirmBtn={submitting ? '提交中…' : '保存'}
      >
        {/* 关键：用 editing?.id 派生 key，强制整个表单子树在切换时完整重建 */}
        {/* 这样能避开 TDesign Input/Select 内部 useControlled 的状态缓存问题 */}
        <FaqEditForm
          key={`form-${editing?.id ?? (creating ? 'new' : 'closed')}`}
          initialValues={
            editing
              ? {
                  question: editing.question,
                  answer: editing.answer,
                  category: editing.category,
                  keywords: editing.keywords || '',
                }
              : { question: '', answer: '', category: 'general', keywords: '' }
          }
          onChange={setForm}
        />
      </Dialog>

      {/* 删除确认弹窗（受控 Dialog，避免 DialogPlugin.confirm 不返回 Promise 的坑） */}
      <Dialog
        header="确认删除"
        visible={!!pendingDelete}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        confirmBtn="删除"
        cancelBtn="取消"
        width={420}
      >
        <div style={{ padding: '8px 0', color: 'var(--td-text-color-primary)' }}>
          确定要删除「{pendingDelete?.question}」吗？该条 FAQ 将从向量库中移除。
        </div>
      </Dialog>
    </div>
  );
}