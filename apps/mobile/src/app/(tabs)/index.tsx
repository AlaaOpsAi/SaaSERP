import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityRow } from '../../components/rows';
import { Button, Card, Empty, H1, H2, Kpi, Notice, Screen, StatusBadge, T } from '../../components/ui';
import { api, type Activity, type Status } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, currencyCode, date, greeting, money, pct, today } from '../../lib/format';
import { useColors } from '../../lib/theme';
import { t } from '../../i18n';

interface Dashboard {
  kpis: Record<string, number | null>; previous: Record<string, number | null>;
  upcoming: { id: string; booking_no: string; name: string; status: Status; event_date: string; pax: number | null; venue_name: string | null; days_until: number }[];
  followups: { overdue: number; today: number };
}

function change(cur: number | null | undefined, prev: number | null | undefined) {
  if (!cur || prev === null || prev === undefined || prev === 0) return undefined;
  const d = (cur - prev) / Math.abs(prev);
  return `${d >= 0 ? '▲' : '▼'} ${t('{pct}% vs last year', { pct: Math.abs(d * 100).toFixed(0) })}`;
}

export default function Home() {
  const { me, can } = useAuth();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const year = new Date().getFullYear();
  const dash = useQuery({ queryKey: ['dashboard', year], queryFn: () => api<Dashboard>(`/reports/dashboard?year=${year}`) });
  const tomorrow = addDays(today(), 1);
  const todo = useQuery({
    queryKey: ['activities', 'home'],
    queryFn: () => api<Activity[]>('/activities?scope=mine&state=open&limit=50'),
    select: (rows) => rows.filter((a) => a.due_at.slice(0, 10) < tomorrow).slice(0, 8),
  });
  const bell = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications'), refetchInterval: 60_000 });
  const k = dash.data?.kpis ?? {};
  const p = dash.data?.previous ?? {};
  const refreshing = dash.isRefetching || todo.isRefetching;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, gap: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { dash.refetch(); todo.refetch(); bell.refetch(); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <H1>{greeting()}, {me?.name.split(' ')[0]}</H1>
            <T muted small>{me?.tenant.name} · {currencyCode()}</T>
          </View>
          <Pressable onPress={() => router.push('/notifications')} accessibilityLabel={t("Notifications")} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="notifications-outline" size={24} color={c.text} />
            {(bell.data?.unread ?? 0) > 0 && (
              <View style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{bell.data!.unread}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {(me?.covering ?? []).length > 0 && (
          <Notice icon="people-outline">{t('You are covering for {names}. Their bookings and follow-ups are in your lists.', { names: me!.covering.map((x) => x.delegator_name).join(', ') })}</Notice>
        )}
        {(me?.covered_by ?? []).length > 0 && <Notice icon="airplane-outline">{t('{names} is covering for you.', { names: me!.covered_by.map((x) => x.delegate_name).join(', ') })}</Notice>}

        {can('sell') && <Button title={t("New enquiry")} icon="add-circle-outline" kind="primary" onPress={() => router.push('/booking/new')} />}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Kpi label={t('Definite revenue {year}', { year })} value={money(k.revenue, true)} sub={change(k.revenue, p.revenue)} onPress={() => router.push('/bookings?filter=won')} />
          <Kpi label={t("Conversion")} value={pct(k.conversion_rate, 1)} sub={`${k.definite ?? 0} of ${k.total ?? 0} bookings`} />
          <Kpi label={t("Open pipeline")} value={money(k.pipeline_value, true)} sub={`${k.open ?? 0} enquiries & holds`} onPress={() => router.push('/bookings?filter=open')} />
          <Kpi label={t("Client outstanding")} value={money(k.outstanding, true)} sub={`margin ${pct(k.margin_pct)}`} />
        </View>

        <H2 right={<Pressable onPress={() => router.push('/activities')}><T small style={{ color: c.accent }}>All</T></Pressable>}>{t("Today's follow-ups")}</H2>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {todo.data?.length ? todo.data.map((a) => <ActivityRow key={a.id} a={a} />) : <Empty icon="checkmark-done-outline">{t("Nothing due today.")}</Empty>}
        </Card>

        <H2>{t("Coming up")}</H2>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {dash.data?.upcoming.length ? dash.data.upcoming.map((u) => (
            <Pressable key={u.id} onPress={() => router.push(`/booking/${u.id}`)}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center', borderBottomWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface })}>
              <View style={{ width: 58, alignItems: 'center', paddingVertical: 4, borderRadius: 8, backgroundColor: u.days_until <= 7 ? c.accentSoft : c.surface2 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: u.days_until <= 7 ? c.accent : c.text2 }}>
                  {u.days_until === 0 ? t("Today") : u.days_until === 1 ? t("Tmrw") : t('{n} d', { n: u.days_until })}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T bold numberOfLines={1}>{u.name}</T>
                <T small muted numberOfLines={1}>{date(u.event_date)}{u.venue_name ? ` · ${u.venue_name}` : ''}{u.pax ? ` · ${t('{n} pax', { n: u.pax })}` : ''}</T>
              </View>
              <StatusBadge status={u.status} />
            </Pressable>
          )) : <Empty icon="calendar-outline">{t("No events in the next 30 days.")}</Empty>}
        </Card>
      </ScrollView>
    </Screen>
  );
}
