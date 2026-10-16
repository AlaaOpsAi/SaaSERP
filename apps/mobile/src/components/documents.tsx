import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, View } from 'react-native';
import { api, getServer, type BookingDetail, type FileKind } from '../lib/api';
import { date, dateTime } from '../lib/format';
import { useColors } from '../lib/theme';
import { t } from '../i18n';
import { Button, Card, Chips, Empty, ErrorText, H2, Notice, T, Tag } from './ui';

const FILE_KINDS: [FileKind, string][] = [['signed_contract', 'Signed contract'], ['signed_proposal', 'Signed proposal'], ['annex', 'Annex'], ['other', 'Other']];
const DOC_KIND: Record<string, string> = { contract: 'Contract', proposal: 'Proposal', annex: 'Annex' };
const MAX = 15 * 1024 * 1024;

interface Picked { uri: string; name: string; type: string; size?: number; file?: Blob }

/** Open a file through its short-lived signed link (PDF viewer, photos, Word). */
export async function openFile(path: string) {
  const { url } = await api<{ url: string }>(path);
  await Linking.openURL(`${getServer()}${url}`);
}

/** Photo of the signed paper (camera or library), or a PDF. */
async function pick(source: 'camera' | 'photos' | 'pdf'): Promise<Picked | null> {
  if (source === 'pdf') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    return { uri: a.uri, name: a.name, type: a.mimeType ?? 'application/pdf', size: a.size, file: a.file };
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error(t('Allow the camera in your phone settings to take a photo of the contract.'));
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const type = a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  return { uri: a.uri, name: a.fileName ?? `signed-${Date.now()}.${type === 'image/png' ? 'png' : 'jpg'}`, type, size: a.fileSize, file: a.file };
}

/** Pick a file and upload it to the contract; false when the picker was closed. */
export async function uploadFile(bookingId: string, kind: FileKind, source: 'camera' | 'photos' | 'pdf') {
  const f = await pick(source);
  if (!f) return false;
  if (f.size && f.size > MAX) throw new Error(t('The file is larger than 15 MB'));
  const form = new FormData();
  // On the web build the picker gives a real File; on phones, React Native sends the file at uri.
  if (Platform.OS === 'web' && f.file) form.append('file', f.file as Blob, f.name);
  else form.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
  await api(`/bookings/${bookingId}/files?kind=${kind}`, { form });
  return true;
}

/** The contract's documents on the phone: the signed copy above all. */
export function Documents({ b, editable }: { b: BookingDetail; editable: boolean }) {
  const c = useColors();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FileKind>('signed_contract');
  const [error, setError] = useState<unknown>(null);
  const upload = useMutation({
    mutationFn: (source: 'camera' | 'photos' | 'pdf') => uploadFile(b.id, kind, source),
    onSuccess: (done) => { if (done) qc.invalidateQueries(); },
  });
  const start = (source: 'camera' | 'photos' | 'pdf') => { setError(null); upload.mutate(source); };
  const open = (path: string) => { setError(null); openFile(path).catch(setError); };

  return (
    <>
      <H2>{t('Documents')}</H2>
      {b.signed_missing && <Notice icon="warning-outline">{t('Signed contract missing: upload the copy the client signed (photo or PDF).')}</Notice>}
      <Card style={{ gap: 10 }}>
        {b.documents.length === 0 && b.files.length === 0 && <Empty icon="document-text-outline">{t('No documents yet.')}</Empty>}
        {b.documents.map((d) => (
          <Pressable key={d.id} onPress={() => open(`/documents/${d.id}/link?format=${d.has_pdf ? 'pdf' : 'docx'}`)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="document-text-outline" size={22} color={c.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <T bold>{d.doc_no} <Tag>{t(DOC_KIND[d.kind])}</Tag></T>
              <T small muted>{dateTime(d.issued_at)} · {d.kind === 'annex' ? (d.template_name ?? '') : d.signed_at ? `${t('Signed')} ${date(d.signed_at)}` : t('Waiting for signature')}</T>
            </View>
            <Ionicons name="open-outline" size={18} color={c.text2} />
          </Pressable>
        ))}
        {b.files.map((f) => (
          <Pressable key={f.id} onPress={() => open(`/booking-files/${f.id}/link`)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={f.mime === 'application/pdf' ? 'document-attach-outline' : 'image-outline'} size={22} color={c.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <T bold numberOfLines={1}>{f.file_name}</T>
              <T small muted>{t(FILE_KINDS.find(([k]) => k === f.kind)?.[1] ?? f.kind)} · {dateTime(f.uploaded_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}</T>
            </View>
            <Ionicons name="open-outline" size={18} color={c.text2} />
          </Pressable>
        ))}
      </Card>
      {editable && (
        <Card style={{ gap: 10 }}>
          <T small muted bold>{t('Upload a file')}</T>
          <Chips<FileKind> value={kind} onChange={setKind} options={FILE_KINDS} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Platform.OS !== 'web' && <Button small icon="camera-outline" title={t('Take photo')} busy={upload.isPending} onPress={() => start('camera')} />}
            <Button small icon="images-outline" title={t('Choose photo')} disabled={upload.isPending} onPress={() => start('photos')} />
            <Button small icon="document-outline" title={t('Choose PDF')} disabled={upload.isPending} onPress={() => start('pdf')} />
          </View>
          <T small muted>{t('Pictures (JPEG, PNG) or PDF, up to 15 MB. Allowed at every status.')}</T>
          <ErrorText error={error ?? upload.error} />
          {upload.data === true && <T small style={{ color: c.good }}>{t('Uploaded.')}</T>}
        </Card>
      )}
    </>
  );
}

/** Right after confirming (DEF): offer to upload the signed copy now (it can wait; the contract stays flagged). */
export function askForSignedCopy(bookingId: string, done: () => void) {
  const go = (source: 'camera' | 'photos' | 'pdf') => uploadFile(bookingId, 'signed_contract', source)
    .then((ok) => ok && done())
    .catch((e) => Alert.alert(t('Upload failed'), e instanceof Error ? e.message : String(e)));
  if (Platform.OS === 'web') return;
  Alert.alert(t('Contract confirmed'), t('Upload the contract the client signed now? You can also do it later: the contract stays flagged until then.'), [
    { text: t('Later'), style: 'cancel' },
    { text: t('Take photo'), onPress: () => go('camera') },
    { text: t('Choose PDF'), onPress: () => go('pdf') },
  ]);
}
