import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Chips, H2, Screen, T, type IconName } from '../../components/ui';
import { api, getServer, type Me, type Preferences } from '../../lib/api';
import { applyUserSettings, useAuth } from '../../lib/auth';
import { date } from '../../lib/format';
import { ACCENTS, useColors } from '../../lib/theme';
import { LANGUAGES, lang, mirrored, t } from '../../i18n';

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Sales manager', sales: 'Sales / account manager', finance: 'Finance', viewer: 'Viewer',
};
const STATE: Record<string, string> = { active: 'Active', upcoming: 'Upcoming', ended: 'Ended', revoked: 'Ended early' };

interface Cover { id: string; delegator_name: string; delegate_name: string; starts_on: string; ends_on: string | null; access: string; state: string }

export default function More() {
  const { me, signOut } = useAuth();
  const c = useColors();
  const bell = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications') });
  const covers = useQuery({ queryKey: ['delegations'], queryFn: () => api<Cover[]>('/delegations') });
  const active = (covers.data ?? []).filter((d) => d.state === 'active' || d.state === 'upcoming');
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <T bold style={{ color: c.accent }}>{(me?.code ?? me?.name ?? '?').slice(0, 3)}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T bold>{me?.name}</T>
            <T small muted>{me?.email}</T>
            <T small muted>{t(ROLE_NAMES[me?.role ?? ''] ?? me?.role ?? '')} · {me?.tenant.name} · {me?.sees_all ? t("sees whole company") : me && me.team_ids.length > 1 ? t('sees own + {n} in team', { n: me.team_ids.length - 1 }) : t("sees own records")}</T>
          </View>
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Item icon="notifications-outline" label={t("Notifications")} badge={bell.data?.unread} onPress={() => router.push('/notifications')} />
          <Item icon="desktop-outline" label={t("Open the full web app")} onPress={() => Linking.openURL(getServer())} />
        </Card>

        <H2>{t("Cover")}</H2>
        <Card style={{ gap: 10 }}>
          {active.length === 0 && <T muted>{t("No cover arranged.")}</T>}
          {active.map((d) => (
            <View key={d.id}>
              <T bold>{t('{who} covers {whom}', { who: d.delegate_name, whom: d.delegator_name })}</T>
              <T small muted>{date(d.starts_on)} – {d.ends_on ? date(d.ends_on) : t("until ended")} · {d.access === 'act' ? t("view & act") : t("view only")} · {t(STATE[d.state] ?? d.state)}</T>
            </View>
          ))}
          <T small muted>{t("Set up or end cover in the web app under Cover & delegation.")}</T>
        </Card>

        <Appearance />

        <T small muted>{t("Server:")}{' '}{getServer()}</T>
        <Button title={t("Sign out")} kind="danger" icon="log-out-outline" onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}

function Item({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface })}>
      <Ionicons name={icon} size={20} color={c.accent} />
      <T style={{ flex: 1 }}>{label}</T>
      {!!badge && <T small bold style={{ color: c.danger }}>{t('{n} new', { n: badge })}</T>}
      <Ionicons name="chevron-forward" size={18} color={c.muted} style={mirrored()} />
    </Pressable>
  );
}

/** Language, theme and accent. Saved to the account, so the web app follows too. */
function Appearance() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const c = useColors();
  const prefs = me?.preferences ?? {};
  const save = async (patch: Partial<Preferences>) => {
    if (!me) return;
    const next = { ...me, preferences: { ...prefs, ...patch } } as Me;
    qc.setQueryData(['me'], next);
    const restart = applyUserSettings(next);
    if (restart) Alert.alert(t('Restart the app'), t('Close and reopen the app to switch the layout direction.'));
    try {
      await api('/me/preferences', { method: 'PATCH', body: patch });
    } catch (e) {
      qc.setQueryData(['me'], me);
      applyUserSettings(me);
      Alert.alert(t('Could not save'), e instanceof Error ? e.message : String(e));
    }
  };
  const accent = prefs.accent ?? null;
  return (
    <>
      <H2>{t('Language & appearance')}</H2>
      <Card style={{ gap: 14 }}>
        <Chips label={t('Language')} value={lang().code} onChange={(code) => save({ locale: code })}
          options={LANGUAGES.map((l) => [l.code, l.name] as [string, string])} />
        <Chips<'system' | 'light' | 'dark'> label={t('Theme')} value={prefs.theme ?? 'system'}
          onChange={(m) => save({ theme: m === 'system' ? null : m })}
          options={[['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']]} />
        <View style={{ gap: 6 }}>
          <T small muted>{t('Accent colour')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Swatch hex={me?.tenant.branding?.accent ?? '#2a78d6'} on={!accent} label={t('Company default')} onPress={() => save({ accent: null })} ring={c.text} />
            {ACCENTS.map((a) => <Swatch key={a.hex} hex={a.hex} on={accent === a.hex} label={t(a.name)} onPress={() => save({ accent: a.hex })} ring={c.text} />)}
          </View>
        </View>
      </Card>
    </>
  );
}

function Swatch({ hex, on, label, onPress, ring }: { hex: string; on: boolean; label: string; onPress: () => void; ring: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }}
      style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hex, borderWidth: on ? 3 : 0, borderColor: ring }} />
  );
}
