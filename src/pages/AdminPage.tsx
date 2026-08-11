/**
 * 管理后台仪表盘页面
 * 展示对话记录、满意度统计、意图分布等
 */

import { useState, useEffect } from 'react';
import { Card, Table, Tag, Statistic, Row, Col, Loading, MessagePlugin, Tabs, Select, Button, Dialog, Textarea, Form } from 'tdesign-react';
import { FileSearch, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import ReactEChartsCore from 'echarts-for-react';

const API_BASE = '/api/admin';

interface TicketRow {
  id: string;
  session_id: string;
  intent: string;
  summary: string;
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_to: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardData {
  overview: {
    totalConversations: number;
    todayConversations: number;
    averageSatisfaction: number;
    totalTickets: number;
    faqHitRate: number;
  };
  satisfactionDistribution: { rating: number; count: number }[];
  intentDistribution: { intent: string; count: number }[];
  ticketByStatus: { status: string; count: number }[];
  recentConversations: {
    sessionId: string;
    title: string;
    messageCount: number;
    satisfaction: number | null;
    createdAt: string;
  }[];
}

const INTENT_LABELS: Record<string, string> = {
  refund: '退款',
  order_inquiry: '查订单',
  tech_support: '技术支持',
  general: '通用咨询',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const STATUS_TAG_THEME: Record<string, 'warning' | 'primary' | 'success' | 'default'> = {
  pending: 'warning',
  processing: 'primary',
  resolved: 'success',
  closed: 'default',
};

export default function AdminPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingTicket, setEditingTicket] = useState<TicketRow | null>(null);
  const [editStatus, setEditStatus] = useState<string>('pending');
  const [editResolution, setEditResolution] = useState('');
  const [conversationDetail, setConversationDetail] = useState<{
    session: any;
    messages: any[];
    satisfaction: any;
  } | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);

  const { authHeader } = useAuth();

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (activeTab === 'tickets') fetchTickets();
  }, [activeTab]);

  const fetchDashboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard`, { headers: { ...authHeader() } });
      const data = await res.json();
      if (data.error) {
        MessagePlugin.error(data.error);
      } else {
        setDashboard(data);
      }
    } catch (err) {
      MessagePlugin.error('获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchTickets = async () => {
    try {
      setTicketsLoading(true);
      const res = await fetch(`${API_BASE}/tickets`, { headers: { ...authHeader() } });
      const data = await res.json();
      if (data.error) {
        MessagePlugin.error(data.error);
      } else {
        setTickets(data.tickets || []);
      }
    } catch (err) {
      MessagePlugin.error('获取工单失败');
    } finally {
      setTicketsLoading(false);
    }
  };

  const openEditTicket = (t: TicketRow) => {
    setEditingTicket(t);
    setEditStatus(t.status);
    setEditResolution(t.resolution || '');
  };

  const submitTicketUpdate = async () => {
    if (!editingTicket) return;
    try {
      const res = await fetch(`${API_BASE}/tickets/${editingTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status: editStatus, resolution: editResolution }),
      });
      const data = await res.json();
      if (data.error) {
        MessagePlugin.error(data.error);
      } else {
        MessagePlugin.success('工单已更新');
        setEditingTicket(null);
        fetchTickets();
      }
    } catch {
      MessagePlugin.error('更新工单失败');
    }
  };

  const filteredTickets = statusFilter === 'all' ? tickets : tickets.filter(t => t.status === statusFilter);

  const openConversationDetail = async (sessionId: string) => {
    try {
      setConversationLoading(true);
      const res = await fetch(`${API_BASE}/conversations/${sessionId}`, { headers: { ...authHeader() } });
      const data = await res.json();
      if (data.error) {
        MessagePlugin.error(data.error);
      } else {
        setConversationDetail(data);
      }
    } catch {
      MessagePlugin.error('获取对话详情失败');
    } finally {
      setConversationLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loading size="large" text="加载中..." />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">暂无数据</p>
      </div>
    );
  }

  const { overview } = dashboard;

  // 满意度饼图配置
  const satisfactionPieOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: '0%' },
    series: [{
      name: '满意度分布',
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 6,
        borderColor: '#fff',
        borderWidth: 2,
      },
      label: { show: true, formatter: '{b}: {c}次' },
      data: dashboard.satisfactionDistribution
        .filter(d => d.count > 0)
        .map(d => ({
          value: d.count,
          name: `${d.rating}星`,
          itemStyle: {
            color: ['#e34d59', '#f48549', '#fac858', '#91cc75', '#5470c6'][d.rating - 1],
          },
        })),
    }],
  };

  // 意图分布柱状图
  const intentBarOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dashboard.intentDistribution.map(d => INTENT_LABELS[d.intent] || d.intent),
    },
    yAxis: { type: 'value', name: '数量' },
    series: [{
      name: '意图分布',
      type: 'bar',
      data: dashboard.intentDistribution.map(d => d.count),
      itemStyle: {
        color: '#0052d9',
        borderRadius: [4, 4, 0, 0],
      },
    }],
  };

  // 工单状态饼图
  const ticketPieOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: '0%' },
    series: [{
      name: '工单状态',
      type: 'pie',
      radius: '65%',
      data: dashboard.ticketByStatus
        .filter(d => d.count > 0)
        .map(d => ({
          value: d.count,
          name: STATUS_LABELS[d.status] || d.status,
        })),
      itemStyle: {
        borderRadius: 4,
        borderColor: '#fff',
        borderWidth: 2,
      },
    }],
  };

  return (
    <div className="p-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--td-text-color-primary)' }}>
        📊 管理后台
      </h1>

      {/* 概览卡片 */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col span={12 / 5}>
          <Card bordered>
            <Statistic title="总会话数" value={overview.totalConversations} />
          </Card>
        </Col>
        <Col span={12 / 5}>
          <Card bordered>
            <Statistic title="今日会话" value={overview.todayConversations} />
          </Card>
        </Col>
        <Col span={12 / 5}>
          <Card bordered>
            <Statistic
              title="平均满意度"
              value={overview.averageSatisfaction}
            />
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              {overview.averageSatisfaction > 0 ? `${overview.averageSatisfaction} 分` : '暂无'}
            </span>
          </Card>
        </Col>
        <Col span={12 / 5}>
          <Card bordered>
            <Statistic title="工单总数" value={overview.totalTickets} />
          </Card>
        </Col>
        <Col span={12 / 5}>
          <Card bordered>
            <Statistic
              title="FAQ命中率"
              value={overview.faqHitRate}
            />
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              {overview.faqHitRate}%
            </span>
          </Card>
        </Col>
      </Row>

      {/* Tab 切换 */}
      <Tabs value={activeTab} onChange={(v) => setActiveTab(v as string)} className="mb-4">
        <Tabs.TabPanel value="overview" label="数据概览" />
        <Tabs.TabPanel value="conversations" label="对话记录" />
        <Tabs.TabPanel value="tickets" label="工单管理" />
      </Tabs>

      {activeTab === 'overview' && (
        <>
          {/* 图表区域 */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col span={4}>
              <Card title="满意度分布" bordered>
                <ReactEChartsCore option={satisfactionPieOption} style={{ height: 300 }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card title="意图分布" bordered>
                <ReactEChartsCore option={intentBarOption} style={{ height: 300 }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card title="工单状态" bordered>
                <ReactEChartsCore option={ticketPieOption} style={{ height: 300 }} />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {activeTab === 'conversations' && (
        <Card title="最近对话记录" bordered>
          <Table
            data={dashboard.recentConversations}
            columns={[
              {
                colKey: 'title',
                title: '会话标题',
                ellipsis: true,
                width: 300,
              },
              {
                colKey: 'messageCount',
                title: '消息数',
                width: 100,
              },
              {
                colKey: 'satisfaction',
                title: '满意度',
                width: 100,
                cell: ({ row }: any) => {
                  if (row.satisfaction === null) return <Tag theme="default">未评价</Tag>;
                  const stars = '⭐'.repeat(row.satisfaction);
                  return <span>{stars}</span>;
                },
              },
              {
                colKey: 'createdAt',
                title: '创建时间',
                width: 180,
                cell: ({ row }: any) => {
                  return new Date(row.createdAt).toLocaleString('zh-CN');
                },
              },
              {
                colKey: 'action',
                title: '操作',
                width: 110,
                cell: ({ row }: any) => (
                  <Button
                    size="small"
                    theme="primary"
                    variant="outline"
                    onClick={() => openConversationDetail(row.sessionId)}
                  >
                    查看详情
                  </Button>
                ),
              },
            ]}
            rowKey="sessionId"
            hover
            stripe
            pagination={{
              defaultPageSize: 10,
              pageSizeOptions: [10, 20, 50],
            }}
          />
        </Card>
      )}

      {activeTab === 'tickets' && (
        <Card title="工单管理" bordered>
          <div className="mb-4 flex items-center gap-3">
            <span>状态过滤：</span>
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as string)}
              style={{ width: 160 }}
              options={[
                { label: '全部', value: 'all' },
                { label: '待处理', value: 'pending' },
                { label: '处理中', value: 'processing' },
                { label: '已解决', value: 'resolved' },
                { label: '已关闭', value: 'closed' },
              ]}
            />
            <Button theme="primary" variant="outline" onClick={fetchTickets}>刷新</Button>
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              共 {filteredTickets.length} 条工单
            </span>
          </div>
          <Table
            data={filteredTickets}
            columns={[
              {
                colKey: 'id',
                title: '工单号',
                width: 140,
                cell: ({ row }: any) => row.id.slice(0, 8) + '...',
              },
              {
                colKey: 'intent',
                title: '意图',
                width: 110,
                cell: ({ row }: any) => <Tag theme="primary" variant="dark">{INTENT_LABELS[row.intent] || row.intent}</Tag>,
              },
              {
                colKey: 'summary',
                title: '摘要',
                ellipsis: true,
                minWidth: 220,
                cell: ({ row }: any) => row.summary || '(无)',
              },
              {
                colKey: 'priority',
                title: '优先级',
                width: 100,
                cell: ({ row }: any) => {
                  const map: Record<string, { theme: any; label: string }> = {
                    urgent: { theme: 'danger', label: '紧急' },
                    high: { theme: 'warning', label: '高' },
                    normal: { theme: 'primary', label: '普通' },
                    low: { theme: 'default', label: '低' },
                  };
                  const cfg = map[row.priority] || map.normal;
                  return <Tag theme={cfg.theme} variant="dark">{cfg.label}</Tag>;
                },
              },
              {
                colKey: 'status',
                title: '状态',
                width: 110,
                cell: ({ row }: any) => (
                  <Tag theme={STATUS_TAG_THEME[row.status]} variant="dark">
                    {STATUS_LABELS[row.status] || row.status}
                  </Tag>
                ),
              },
              {
                colKey: 'created_at',
                title: '创建时间',
                width: 170,
                cell: ({ row }: any) => new Date(row.created_at).toLocaleString('zh-CN'),
              },
              {
                colKey: 'action',
                title: '操作',
                width: 110,
                cell: ({ row }: any) => (
                  <Button size="small" theme="primary" variant="outline" onClick={() => openEditTicket(row)}>
                    处理
                  </Button>
                ),
              },
            ]}
            rowKey="id"
            hover
            stripe
            loading={ticketsLoading}
            empty="暂无工单"
            pagination={{
              defaultPageSize: 10,
              pageSizeOptions: [10, 20, 50],
            }}
          />
        </Card>
      )}

      {/* 处理工单弹窗 */}
      <Dialog
        visible={!!editingTicket}
        onClose={() => setEditingTicket(null)}
        onConfirm={submitTicketUpdate}
        header="处理工单"
        width={520}
        confirmBtn="保存"
      >
        {editingTicket && (
          <div>
            <p style={{ marginBottom: 12 }}>
              <b>摘要：</b>{editingTicket.summary}
            </p>
            <Form labelWidth={80}>
              <Form.FormItem label="状态">
                <Select
                  value={editStatus}
                  onChange={(v) => setEditStatus(v as string)}
                  options={[
                    { label: '待处理', value: 'pending' },
                    { label: '处理中', value: 'processing' },
                    { label: '已解决', value: 'resolved' },
                    { label: '已关闭', value: 'closed' },
                  ]}
                />
              </Form.FormItem>
              <Form.FormItem label="解决方案">
                <Textarea
                  value={editResolution}
                  onChange={(v) => setEditResolution(v as string)}
                  placeholder="选填：填写处理方案 / 回复客户的内容"
                  autosize={{ minRows: 3, maxRows: 6 }}
                />
              </Form.FormItem>
            </Form>
          </div>
        )}
      </Dialog>

      {/* 对话详情弹窗 */}
      <Dialog
        visible={!!conversationDetail}
        onClose={() => setConversationDetail(null)}
        onConfirm={() => setConversationDetail(null)}
        header="对话详情"
        width={720}
        confirmBtn="关闭"
        cancelBtn={null}
      >
        {conversationDetail && (
          <div>
            {/* 会话基本信息 */}
            <div className="mb-3 p-3" style={{ background: 'var(--td-bg-color-container)', borderRadius: 6 }}>
              <div className="mb-1">
                <b>会话标题：</b>{conversationDetail.session?.title || '(无标题)'}
              </div>
              <div className="mb-1">
                <b>模型：</b>
                <Tag theme="primary" variant="dark">{conversationDetail.session?.model || '-'}</Tag>
              </div>
              <div className="mb-1">
                <b>创建时间：</b>
                {new Date(conversationDetail.session?.created_at).toLocaleString('zh-CN')}
              </div>
              <div>
                <b>满意度：</b>
                {conversationDetail.satisfaction
                  ? `${'⭐'.repeat(conversationDetail.satisfaction.rating)} ${conversationDetail.satisfaction.rating} 分${conversationDetail.satisfaction.comment ? ' — ' + conversationDetail.satisfaction.comment : ''}`
                  : <Tag theme="default">未评价</Tag>}
              </div>
            </div>

            {conversationLoading && (
              <div className="text-center py-6">
                <Loading text="加载中..." />
              </div>
            )}

            {!conversationLoading && conversationDetail.messages.length === 0 && (
              <div className="text-center py-6" style={{ color: 'var(--td-text-color-placeholder)' }}>
                该会话暂无消息
              </div>
            )}

            {!conversationLoading && conversationDetail.messages.map((msg: any, idx: number) => (
              <div
                key={msg.id || idx}
                className="mb-3 p-3"
                style={{
                  background: msg.role === 'user' ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-container)',
                  borderRadius: 6,
                  borderLeft: msg.role === 'user'
                    ? '3px solid var(--td-brand-color)'
                    : '3px solid var(--td-success-color)',
                }}
              >
                <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  <b>{msg.role === 'user' ? '👤 用户' : '🤖 AI'}</b>
                  <span>{new Date(msg.created_at).toLocaleString('zh-CN')}</span>
                  {msg.intent && (
                    <Tag size="small" theme="primary" variant="dark">
                      {INTENT_LABELS[msg.intent] || msg.intent}
                    </Tag>
                  )}
                  {msg.used_faq && (
                    <Tag size="small" theme="primary" variant="dark" icon={<FileSearch size={12} />}>
                      知识库匹配
                    </Tag>
                  )}
                  {msg.should_escalate && (
                    <Tag size="small" theme="warning" variant="dark" icon={<AlertCircle size={12} />}>
                      已转人工
                    </Tag>
                  )}
                  {!msg.used_faq && !msg.should_escalate && msg.role === 'assistant' && (
                    <Tag size="small" theme="success" variant="dark" icon={<CheckCircle2 size={12} />}>
                      AI 回复
                    </Tag>
                  )}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}
