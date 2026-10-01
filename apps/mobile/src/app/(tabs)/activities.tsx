import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { ActivityRow } from '../../components/rows';
import { Chips, Empty, ErrorText, Screen } from '../../components/ui';
import { api, type Activity } from '../../lib/api';
import { useColors } from '../../lib/theme';

type State = 'today' | 'overdue' | 'open' | 'done';

export default function Activities() {
  const c = useColors();
  const [state, setState] = useState<State>('open');
  const q = useQuery({
    queryKey: ['activities', 'mine', state],
    queryFn: () => api<Activity[]>(`/activities?scope=mine&state=${state}&limit=200`),
  });
  return (
    <Screen>
      <View style={{ padding: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border }}>
        <Chips<State> value={state} onChange={setState}
          options={[['today', 'Today'], ['overdue', 'Overdue'], ['open', 'All open'], ['done', 'Done']]} />
      </View>
      <ErrorText error={q.error} />
      <FlatList
        data={q.data ?? []}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <ActivityRow a={item} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        ListEmptyComponent={q.isLoading ? <ActivityIndicator style={{ margin: 30 }} />
          : <Empty icon="checkmark-done-outline">{state === 'done' ? 'Nothing completed yet.' : 'All clear.'}</Empty>}
      />
    </Screen>
  );
}
