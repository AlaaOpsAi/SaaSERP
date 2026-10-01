import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FlatList, View } from 'react-native';
import { Empty, Screen, T } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useColors } from '../lib/theme';

interface Note { id: string; text: string; read_at: string | null; created_at: string }

export default function Notifications() {
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Note[]; unread: number }>('/notifications') });
  const read = useMutation({ mutationFn: () => api('/notifications/read', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  // Opening the list marks everything as read (the list keeps showing which were new).
  useEffect(() => {
    if (q.data?.unread) read.mutate();
  }, [q.data?.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen>
      <FlatList data={q.data?.items ?? []} keyExtractor={(n) => n.id}
        renderItem={({ item }) => (
          <View style={{ padding: 14, gap: 4, borderBottomWidth: 1, borderColor: c.border, backgroundColor: item.read_at ? c.surface : c.accentSoft }}>
            <T>{item.text}</T>
            <T small muted>{dateTime(item.created_at)}</T>
          </View>
        )}
        ListEmptyComponent={<Empty icon="notifications-off-outline">No notifications yet.</Empty>} />
    </Screen>
  );
}
