/**
 * =============================================================================
 * HERMES - Platform Admin girisi (WS9)
 * =============================================================================
 * Tenant giris ekraniyla AYNI tasarim dilini kullanir (ayni tokenlar,
 * ayni tipografi, light/dark) ama AYRI bir oturum acar: farkli uc,
 * farkli cerez, farkli audience.
 *
 * Basarisiz her durum AYNI mesaji alir — hangi e-postanin operator
 * oldugu buradan ogrenilemez.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'

import { platformService } from '../../api/platformApi'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'

const { Title, Text } = Typography

export default function PlatformLoginPage() {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const login = usePlatformAuthStore((s) => s.login)
    const navigate = useNavigate()

    const handleSubmit = async (values) => {
        setLoading(true)
        setError(null)
        try {
            const result = await platformService.login(
                values.email, values.password,
            )
            login(result.admin, result.permissions)
            navigate('/platform-admin', { replace: true })
        } catch (err) {
            // Tek jenerik mesaj: kimlik/operator varligi sizmaz.
            setError('Invalid credentials.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="platform-login-page" style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: 24,
            background: 'var(--color-bg-layout, #f5f5f5)',
        }}>
            <Card style={{ width: '100%', maxWidth: 420 }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <SafetyCertificateOutlined
                        style={{ fontSize: 32, color: 'var(--color-primary)' }}
                    />
                    <Title level={4} style={{ marginTop: 12, marginBottom: 4 }}>
                        Platform Administration
                    </Title>
                    <Text type="secondary">
                        Hermes operator console — separate from workspace sign-in.
                    </Text>
                </div>

                {error && (
                    <Alert
                        type="error" showIcon message={error}
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Form layout="vertical" onFinish={handleSubmit} disabled={loading}>
                    <Form.Item
                        name="email" label="E-mail"
                        rules={[{ required: true, message: 'E-mail is required' }]}
                    >
                        <Input
                            prefix={<UserOutlined />} autoComplete="username"
                            placeholder="operator@hermes.dev"
                        />
                    </Form.Item>
                    <Form.Item
                        name="password" label="Password"
                        rules={[{ required: true, message: 'Password is required' }]}
                    >
                        <Input.Password
                            prefix={<LockOutlined />}
                            autoComplete="current-password"
                        />
                    </Form.Item>
                    <Button
                        type="primary" htmlType="submit" block loading={loading}
                    >
                        Sign in
                    </Button>
                </Form>
            </Card>
        </div>
    )
}
