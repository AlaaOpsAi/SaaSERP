import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { BookingRow } from '../../components/rows';
import { Chips, Empty, ErrorText, Screen, T } from '../../components/ui';
import { api, type Booking } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { useColors } from '../../lib/theme';

type Filter = 'open' | 'won' | 'lost' | 'all';
const STATUS: Record<Filter, string> = { open: 'INQ,TEN', won: 'DEF,ACT', lost: 'LOS,CXL', all: '' };
const PAGE = 40;

export default function Bookings() {
  const c = useColors();
  const { can } = useAuth();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'open');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { if (params.filter) setFilter(params.filter); }, [params.filter]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => can('sell') && (
        <Pressable onPress={() => router.push('/booking/new')} accessibilityLabel="New enquiry" hitSlop={10} style={{ paddingHorizontal: 14 }}>
          <Ionicons name="add-circle" size={28} color={c.accent} />
        </Pressable>
      ),
    });
  }, [navigation, c, can]);

  const list = useInfiniteQuery({
    queryKey: ['bookings', filter, query],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(pageParam), sort: filter === 'open' ? 'event_date' : '-inquiry_date' });
      if (STATUS[filter]) p.set('status', STATUS[filter]);
      if (query) p.set('q', query);
      return api<{ rows: Booking[]; totals: Record<string, number> }>(`/bookings?${p}`);
    },
    getNextPageParam: (last, pages) => (last.rows.length === PAGE ? pages.length * PAGE : undefined),
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const totals = list.data?.pages[0]?.totals;

  return (
    <Screen>
      <View style={{ padding: 12, gap: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface2, borderRadius: 10, paddingHorizontal: 10 }}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Name, client, phone, booking no." placeholderTextColor={c.muted}
            style={{ flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 }} autoCorrect={false} clearButtonMode="while-editing" />
        </View>
        <Chips<Filter> value={filter} onChange={setFilter}
          options={[['open', 'Open'], ['won', 'Definite'], ['lost', 'Lost'], ['all', 'All']]} />
        {totals && <T small muted>{totals.count} bookings{totals.revenue ? ` · ${money(totals.revenue, true)} definite revenue` : ''}</T>}
      </View>
      <ErrorText error={list.error} />
      <FlatList
        data={rows}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <BookingRow b={item} />}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} />}
        ListEmptyComponent={list.isLoading ? <ActivityIndicator style={{ margin: 30 }} /> : <Empty icon="search-outline">No bookings match.</Empty>}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} /> : null}
      />
    </Screen>
  );
}
