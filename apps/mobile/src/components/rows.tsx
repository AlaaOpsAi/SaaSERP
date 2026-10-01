import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { api, type Activity, type Booking } from '../lib/api';
import { date, dateTime, money } from '../lib/format';
import { useColors } from '../lib/theme';
import { StatusBadge, T, Tag } from './ui';

export function BookingRow({ b }: { b: Booking }) {
  const c = useColors();
  return (
    <Pressable onPress={() => router.push(`/booking/${b.id}`)} accessibilityRole="button"
      style={({ pressed }) => ({ padding: 14, backgroundColor: pressed ? c.surface2 : c.surface, borderBottomWidth: 1, borderColor: c.border, gap: 6 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <T bold numberOfLines={1} style={{ flex: 1 }}>{b.name}</T>
        <StatusBadge status={b.status} />
      </View>
      <T small muted numberOfLines={1}>
        {b.booking_no} · {date(b.event_date)}{b.venue_name ? ` · ${b.venue_name}` : ''}{b.pax ? ` · ${b.pax} pax` : ''}
      </T>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T small muted numberOfLines={1} style={{ flex: 1 }}>{[b.contact_name, b.contact_phone].filter(Boolean).join(' · ') || 'No client'}</T>
        {b.revenue > 0 && <T small bold>{money(b.revenue, true)}</T>}
        {b.owner_code && <T small muted>  {b.owner_code}</T>}
      </View>
    </Pressable>
  );
}

/** A follow-up with a one-tap "done" button. */
export function ActivityRow({ a, showBooking = true }: { a: Activity; showBooking?: boolean }) {
  const c = useColors();
  const qc = useQueryClient();
  const done = Boolean(a.completed_at);
  const overdue = !done && new Date(a.due_at).getTime() < Date.now();
  const complete = useMutation({
    mutationFn: () => api(`/activities/${a.id}/complete`, { body: {} }),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`Mark ${a.subject} done`}
        disabled={done || complete.isPending} onPress={() => complete.mutate()} hitSlop={10}>
        <Ionicons name={done || complete.isSuccess ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={done ? c.good : c.accent} />
      </Pressable>
      <Pressable style={{ flex: 1, gap: 3 }} disabled={!a.booking_id} onPress={() => a.booking_id && router.push(`/booking/${a.booking_id}`)}>
        <T bold style={done ? { textDecorationLine: 'line-through', color: c.muted } : undefined} numberOfLines={2}>{a.subject}</T>
        <T small muted style={overdue ? { color: c.danger } : undefined}>
          {overdue ? 'Overdue · ' : ''}{dateTime(a.due_at)} · {a.type.replace('_', ' ')}
        </T>
        {showBooking && a.booking_name && <T small muted numberOfLines={1}>{a.booking_no} · {a.booking_name}{a.contact_phone ? ` · ${a.contact_phone}` : ''}</T>}
        {a.not_mine && !done && <Tag accent>covering · {a.owner_name}</Tag>}
        {done && a.completed_on_behalf_of_name && <T small muted>done by {a.completed_by_name} for {a.completed_on_behalf_of_name}</T>}
      </Pressable>
    </View>
  );
}
