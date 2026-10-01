import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, H2, Screen, T, type IconName } from '../../components/ui';
import { api, getServer } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date } from '../../lib/format';
import { useColors } from '../../lib/theme';

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
            <T small muted>{me?.role} · {me?.tenant.name} · {me?.sees_all ? 'sees whole company' : me && me.team_ids.length > 1 ? `sees own + ${me.team_ids.length - 1} in team` : 'sees own records'}</T>
          </View>
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Item icon="notifications-outline" label="Notifications" badge={bell.data?.unread} onPress={() => router.push('/notifications')} />
          <Item icon="desktop-outline" label="Open the full web app" onPress={() => Linking.openURL(getServer())} />
        </Card>

        <H2>Cover</H2>
        <Card style={{ gap: 10 }}>
          {active.length === 0 && <T muted>No cover arranged.</T>}
          {active.map((d) => (
            <View key={d.id}>
              <T bold>{d.delegate_name} covers {d.delegator_name}</T>
              <T small muted>{date(d.starts_on)} – {d.ends_on ? date(d.ends_on) : 'until ended'} · {d.access === 'act' ? 'view & act' : 'view only'} · {d.state}</T>
            </View>
          ))}
          <T small muted>Set up or end cover in the web app under Cover & delegation.</T>
        </Card>

        <T small muted>Server: {getServer()}</T>
        <Button title="Sign out" kind="danger" icon="log-out-outline" onPress={() => signOut()} />
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
      {!!badge && <T small bold style={{ color: c.danger }}>{badge} new</T>}
      <Ionicons name="chevron-forward" size={18} color={c.muted} />
    </Pressable>
  );
}
