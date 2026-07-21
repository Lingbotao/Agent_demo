/**
 * 管理后台仪表盘页面
 * 展示对话记录、满意度统计、意图分布等
 */

import { useState, useEffect } from 'react';
import { Card, Table, Tag, Statistic, Row, Col, Loading, MessagePlugin, Tabs } from 'tdesign-react';
import ReactEChartsCore from 'echarts-for-react';

const API_BASE = '/api/admin';

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

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard`);
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
    </div>
  );
}
