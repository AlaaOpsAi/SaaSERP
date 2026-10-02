import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Card, Empty, Screen, StatusBadge, T } from '../../components/ui';
import { api, type Status } from '../../lib/api';
import { addDays, date, time, today } from '../../lib/format';
import { useColors } from '../../lib/theme';
import { intlLocale, mirrored, t } from '../../i18n';

interface Diary {
  spaces: { id: string; name: string; venue_name: string; capacity: number | null }[];
  events: { id: string; name: string; function_space_id: string; start_at: string; end_at: string; booking_id: string | null;
            booking_no: string; booking_name: string; status: Status; expected_pax: number | null; overlaps: boolean }[];
}

/** One day at a time: which rooms are taken, and by whom. */
export default function DiaryScreen() {
  const c = useColors();
  const [day, setDay] = useState(today());
  const q = useQuery({ queryKey: ['diary', day], queryFn: () => api<Diary>(`/diary?from=${day}&to=${day}`) });
  const spaces = q.data?.spaces ?? [];
  const busy = spaces.filter((s) => q.data?.events.some((e) => e.function_space_id === s.id));
  const free = spaces.length - busy.length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border }}>
        <Pressable onPress={() => setDay(addDays(day, -1))} accessibilityLabel={t("Previous day")} hitSlop={10}><Ionicons name="chevron-back" size={24} color={c.accent} style={mirrored()} /></Pressable>
        <Pressable onPress={() => setDay(today())} accessibilityLabel={t("Today")}>
          <T bold style={{ textAlign: 'center' }}>{new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: 'long', timeZone: 'UTC' })}</T>
          <T small muted style={{ textAlign: 'center' }}>{date(day)}{day === today() ? t(" · today") : ''}</T>
        </Pressable>
        <Pressable onPress={() => setDay(addDays(day, 1))} accessibilityLabel={t("Next day")} hitSlop={10}><Ionicons name="chevron-forward" size={24} color={c.accent} style={mirrored()} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
        <T small muted>{t('{busy} booked · {free} free', { busy: busy.length, free })}</T>
        {busy.length === 0 && !q.isLoading && <Empty icon="calendar-clear-outline">{t("Every room is free this day.")}</Empty>}
        {busy.map((s) => (
          <Card key={s.id} style={{ gap: 10 }}>
            <View>
              <T bold>{s.name}</T>
              <T small muted>{s.venue_name}{s.capacity ? ` · ${t('up to {n}', { n: s.capacity })}` : ''}</T>
            </View>
            {q.data!.events.filter((e) => e.function_space_id === s.id).map((e) => (
              <Pressable key={e.id} disabled={!e.booking_id} onPress={() => e.booking_id && router.push(`/booking/${e.booking_id}`)}
                style={{ borderLeftWidth: 3, borderColor: e.overlaps ? c.danger : c.accent, paddingLeft: 10, gap: 4 }}>
                <T bold>{time(e.start_at)}–{time(e.end_at)} · {e.booking_id ? e.booking_name : t("Booked by another team")}</T>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <StatusBadge status={e.status} />
                  {e.booking_no ? <T small muted>{e.booking_no}{e.expected_pax ? ` · ${t('{n} pax', { n: e.expected_pax })}` : ''}</T> : null}
                  {e.overlaps && <T small style={{ color: c.danger }}>{t("clash")}</T>}
                </View>
              </Pressable>
            ))}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
