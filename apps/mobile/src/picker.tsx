import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "./i18n";
import { font, useTheme } from "./theme";
import { Icon, T } from "./ui";

export interface PickerOption {
  value: string;
  label: string;
  /** Secondary text, also searchable. */
  hint?: string;
  /** Options with the same group are listed under one heading. */
  group?: string;
  icon?: ReactNode;
  /** Extra words that match a search but are not displayed. */
  keywords?: string;
}

/**
 * Searchable picker for phones: a field that opens a full-screen sheet with a search box and a grouped list.
 * With `onQuery` the parent supplies results as the user types (e.g. a remote coin search); otherwise the
 * list is filtered here.
 */
export function SearchPicker({ label, value, options, onChange, placeholder: placeholderProp, searchPlaceholder: searchProp, emptyText: emptyProp, onQuery, loading, footer, disabled }: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string, option: PickerOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onQuery?: (text: string) => void;
  loading?: boolean;
  footer?: string;
  disabled?: boolean;
}) {
  const c = useTheme();
  const t = useT();
  const placeholder = placeholderProp ?? t("Pilih…", "Choose…");
  const searchPlaceholder = searchProp ?? t("Cari…", "Search…");
  const emptyText = emptyProp ?? t("Tidak ada hasil", "No results");
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const selected = options.find((o) => o.value === value);

  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q || onQuery) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q));
  }, [options, text, onQuery]);

  useEffect(() => {
    if (!onQuery || !open) return;
    const timer = setTimeout(() => onQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text, onQuery, open]);

  const close = () => { setOpen(false); setText(""); };

  let lastGroup: string | undefined;

  return (
    <View style={{ gap: 6 }}>
      <T v="label" muted>{label}</T>
      <Pressable
        onPress={() => !disabled && setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, opacity: disabled ? 0.55 : 1 }}
      >
        {selected?.icon}
        <View style={{ flex: 1 }}>
          {selected ? (
            <>
              <Text numberOfLines={1} style={{ color: c.ink, fontFamily: font.sansMedium, fontSize: 15 }}>{selected.label}</Text>
              {selected.hint ? <Text numberOfLines={1} style={{ color: c.muted, fontFamily: font.sans, fontSize: 12 }}>{selected.hint}</Text> : null}
            </>
          ) : <Text style={{ color: c.muted, fontFamily: font.sansMedium, fontSize: 15 }}>{placeholder}</Text>}
        </View>
        <Icon name="chevronDown" size={18} color={c.muted} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 }}>
            <T v="heading" accessibilityRole="header">{label}</T>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("Tutup", "Close")} hitSlop={10}><Icon name="x" size={24} color={c.ink} /></Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, paddingHorizontal: 12, backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12 }}>
            <Icon name="search" size={18} color={c.muted} />
            <TextInput
              autoFocus value={text} onChangeText={setText} placeholder={searchPlaceholder} placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false}
              accessibilityLabel={searchPlaceholder} style={{ flex: 1, paddingVertical: 12, color: c.ink, fontFamily: font.sansMedium, fontSize: 15 }}
            />
            {loading ? <ActivityIndicator size="small" color={c.gold} /> : null}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            {!loading && visible.length === 0 ? <T v="small" muted style={{ textAlign: "center", paddingVertical: 24 }}>{emptyText}</T> : null}
            {visible.map((o) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const on = o.value === value;
              return (
                <View key={o.value}>
                  {heading ? <T v="label" muted style={{ marginTop: 14, marginBottom: 6, letterSpacing: 0.8, textTransform: "uppercase", fontSize: 11 }}>{heading}</T> : null}
                  <Pressable
                    onPress={() => { onChange(o.value, o); close(); }} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${o.label}${o.hint ? `, ${o.hint}` : ""}`}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: on || pressed ? c.mori : "transparent" })}
                  >
                    {o.icon}
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: c.ink, fontFamily: on ? font.sansBold : font.sansMedium, fontSize: 15 }}>{o.label}</Text>
                      {o.hint ? <Text numberOfLines={1} style={{ color: c.muted, fontFamily: font.sans, fontSize: 12 }}>{o.hint}</Text> : null}
                    </View>
                    {on ? <Icon name="check" size={18} color={c.gold} /> : null}
                  </Pressable>
                </View>
              );
            })}
            {footer ? <T v="small" muted style={{ marginTop: 16 }}>{footer}</T> : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
