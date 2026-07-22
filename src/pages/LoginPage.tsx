import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, MessagePlugin } from 'tdesign-react';
import { LockOnIcon, UserIcon } from 'tdesign-icons-react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 登录成功后跳转目标：优先尝试原本想去的页面
  const from = (location.state as { from?: string } | null)?.from || '/';

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      MessagePlugin.warning('请输入用户名和密码');
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      MessagePlugin.success('登录成功');
      navigate(from, { replace: true });
    } catch (err: any) {
      MessagePlugin.error(err?.message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--td-bg-color-page)' }}
    >
      <div
        className="w-[400px] p-8 rounded-2xl shadow-xl"
        style={{
          backgroundColor: 'var(--td-bg-color-container)',
          border: '1px solid var(--td-component-border)',
        }}
      >
        <div className="text-center mb-6">
          <div className="text-2xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            智能客服
          </div>
          <div className="text-sm mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>
            请登录后继续
          </div>
        </div>

        <Form onSubmit={handleSubmit} labelWidth={0}>
          <Form.FormItem>
            <Input
              size="large"
              value={username}
              onChange={(v) => setUsername(v as string)}
              placeholder="用户名"
              prefixIcon={<UserIcon />}
              clearable
              autofocus
            />
          </Form.FormItem>
          <Form.FormItem>
            <Input
              size="large"
              type="password"
              value={password}
              onChange={(v) => setPassword(v as string)}
              placeholder="密码"
              prefixIcon={<LockOnIcon />}
              clearable
              onEnter={(v) => {
                if (v) handleSubmit();
              }}
            />
          </Form.FormItem>
          <Button
            theme="primary"
            size="large"
            block
            loading={submitting}
            onClick={() => handleSubmit()}
          >
            登录
          </Button>
        </Form>

        <div
          className="text-xs mt-6 text-center"
          style={{ color: 'var(--td-text-color-placeholder)' }}
        >
          默认管理员账号：admin / admin123（请尽快修改）
        </div>
      </div>
    </div>
  );
}