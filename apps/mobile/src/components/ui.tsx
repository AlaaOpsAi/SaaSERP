import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import type { Status } from '../lib/api';
import { STATUS_LABEL } from '../lib/format';
import { STATUS_COLOR, useColors } from '../lib/theme';
import { t } from '../i18n';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useColors();
  const base = [s.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  return onPress
    ? <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.7 }]}>{children}</Pressable>
    : <View style={base}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={[s.h1, { color: useColors().text }]}>{children}</Text>;
}
export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={s.h2row}>
      <Text style={[s.h2, { color: c.text }]}>{children}</Text>
      {right}
    </View>
  );
}
export function T({ children, muted, small, bold, style, numberOfLines }: {
  children: ReactNode; muted?: boolean; small?: boolean; bold?: boolean; style?: StyleProp<any>; numberOfLines?: number;
}) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: muted ? c.text2 : c.text, fontSize: small ? 12.5 : 15, fontWeight: bold ? '600' : '400' }, style]}>
      {children}
    </Text>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const c = useColors();
  return (
    <View style={[s.badge, { backgroundColor: c.surface2 }]}>
      <View style={[s.dot, { backgroundColor: STATUS_COLOR[status] }]} />
      <Text style={{ color: c.text2, fontSize: 12, fontWeight: '600' }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Tag({ children, accent }: { children: ReactNode; accent?: boolean }) {
  const c = useColors();
  return (
    <Text style={[s.tag, { backgroundColor: accent ? c.accentSoft : c.surface2, color: accent ? c.accent : c.text2 }]}>{children}</Text>
  );
}

export function Button({ title, onPress, kind = 'default', icon, disabled, busy, small, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'default' | 'danger' | 'ghost'; icon?: IconName;
  disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = kind === 'primary' ? c.accent : kind === 'ghost' ? 'transparent' : c.surface;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.danger : c.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.button, small && s.buttonSmall, {
        backgroundColor: bg, borderColor: kind === 'primary' ? c.accent : kind === 'ghost' ? 'transparent' : c.borderStrong,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon && <Ionicons name={icon} size={small ? 15 : 18} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text2, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
      <TextInput placeholderTextColor={c.muted} {...props}
        style={[s.input, { color: c.text, backgroundColor: c.surface, borderColor: c.borderStrong }, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]} />
    </View>
  );
}

/** Horizontal choice chips (status filters, event types, quick dates). */
export function Chips<T extends string>({ options, value, onChange, label }: {
  options: [T, string][]; value: T | null; onChange: (v: T) => void; label?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={{ color: c.text2, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>}
      <View style={s.chips}>
        {options.map(([k, l]) => {
          const on = k === value;
          return (
            <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[s.chip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.borderStrong }]}>
              <Text style={{ color: on ? c.onAccent : c.text, fontSize: 13, fontWeight: '600' }}>{t(l)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Kpi({ label, value, sub, onPress }: { label: string; value: string; sub?: ReactNode; onPress?: () => void }) {
  const c = useColors();
  return (
    <Card style={s.kpi} onPress={onPress}>
      <Text style={{ color: c.text2, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub !== undefined && <Text style={{ color: c.text2, fontSize: 12 }} numberOfLines={1}>{sub}</Text>}
    </Card>
  );
}

export function Empty({ children, icon = 'sparkles-outline' }: { children: ReactNode; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: 28, gap: 8 }}>
      <Ionicons name={icon} size={26} color={c.muted} />
      <Text style={{ color: c.muted, textAlign: 'center' }}>{children}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const c = useColors();
  if (!error) return null;
  return <Text style={[s.alert, { backgroundColor: c.dangerSoft, color: c.danger }]}>{(error as Error).message}</Text>;
}

export function Notice({ children, icon = 'information-circle-outline' }: { children: ReactNode; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={[s.notice, { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
      <Ionicons name={icon} size={18} color={c.accent} />
      <Text style={{ color: c.text, flex: 1, fontSize: 13.5 }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return <View style={{ padding: 40 }}><ActivityIndicator /></View>;
}

export const s = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  h2row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '700' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tag: { fontSize: 11.5, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', alignSelf: 'flex-start' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, minHeight: 44 },
  buttonSmall: { minHeight: 34, paddingHorizontal: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  kpi: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  alert: { padding: 10, borderRadius: 10, overflow: 'hidden', fontSize: 13.5 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 12 },
});
