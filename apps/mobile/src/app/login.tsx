import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, ErrorText, Field, H1, Notice, Screen, T } from '../components/ui';
import { api, ApiError, getServer, setServer } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { t } from '../i18n';

const INACTIVE: Record<string, string> = {
  pending: 'Your workspace is waiting for approval.',
  rejected: 'Your workspace request was not approved.',
  suspended: 'This workspace has been suspended. Please contact support.',
};

export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [server, setServerText] = useState(getServer());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [workspaces, setWorkspaces] = useState<{ slug: string; name: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [inactive, setInactive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setInactive(null);
    try {
      await setServer(server);
      const { token } = await api<{ token: string }>('/auth/login', {
        body: { email: email.trim(), password, workspace: workspace || undefined },
      });
      await signIn(token);
    } catch (err) {
      if (err instanceof ApiError && err.details?.workspaces) setWorkspaces(err.details.workspaces);
      else if (err instanceof ApiError && err.details?.tenant_status) {
        setInactive(`${t(INACTIVE[err.details.tenant_status] ?? 'This workspace is not active.')}${err.details.reason ? ` ${t('Reason: {reason}', { reason: err.details.reason })}` : ''}`);
      } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  /** "Forgot password?": the workspace's owners and admins are told and set a new password. */
  async function forgot() {
    if (!email.trim()) {
      Alert.alert(t('Forgot your password?'), t('Type your email or employee ID first, then tap "Forgot password?" again.'));
      return;
    }
    try {
      await setServer(server);
      await api('/auth/forgot-password', { body: { email: email.trim(), workspace: workspace || undefined } });
      Alert.alert(t('Forgot your password?'), t('Request sent. If this account exists, your admins have been told and will give you a new password. If you are the only admin, contact your SaaSERP provider.'));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 40, gap: 18 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>SE</Text>
            </View>
            <H1>{t("Sign in")}</H1>
            <T muted>{t("Events & catering sales on the go.")}</T>
          </View>
          {inactive && <Notice>{inactive}</Notice>}
          <ErrorText error={error} />
          <Card style={{ gap: 14 }}>
            <Field label={t("Email or employee ID")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="username"
              autoCorrect={false} textContentType="username" />
            <Field label={t("Password")} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
            <Pressable onPress={forgot} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-end' }}>
              <T small style={{ color: c.accent }}>{t('Forgot password?')}</T>
            </Pressable>
            {workspaces && (
              <View style={{ gap: 8 }}>
                <T small muted>{t("This email belongs to several workspaces. Choose one:")}</T>
                {workspaces.map((w) => (
                  <Button key={w.slug} title={`${w.name} (${w.slug})`} kind={workspace === w.slug ? 'primary' : 'default'} onPress={() => setWorkspace(w.slug)} />
                ))}
              </View>
            )}
            <Button title={busy ? t("Signing in…") : t("Sign in")} kind="primary" onPress={submit} busy={busy} disabled={!email || !password} />
          </Card>
          <Card style={{ gap: 8 }}>
            <Field label={t("Server address")} value={server} onChangeText={setServerText} autoCapitalize="none" autoCorrect={false}
              keyboardType="url" placeholder="https://app.opsaibridge.eu" />
            <T small muted>{t("Where SaaSERP runs. Normally leave this as it is. To test against SaaSERP on your Mac, use the Mac's Wi-Fi address, e.g. http://192.168.1.20:4000, with the phone on the same Wi-Fi.")}</T>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
