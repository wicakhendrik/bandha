import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { DONATE_WALLETS, QRIS, qrMatrix, qrPath, type CryptoWallet } from "@bandha/api-client";
import { goBack } from "../../src/nav";
import { useT } from "../../src/i18n";
import { font, useTheme } from "../../src/theme";
import { Btn, Card, Screen, T } from "../../src/ui";

const QRIS_IMAGE = require("../../assets/donate/qris.webp");
const QRIS_RATIO = 1136 / 1600; // pixel size of qris.webp

/** The wallet address as a QR code, drawn locally. Always dark on white so any scanner can read it, in either theme. */
function Qr({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const { d, n } = useMemo(() => { const m = qrMatrix(text); return { d: qrPath(m), n: m.length }; }, [text]);
  const quiet = 3;
  const box = n + quiet * 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignSelf: "center", borderRadius: 10, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`}>
        <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
        <Path d={d} fill="#1b110a" />
      </Svg>
    </View>
  );
}

function CopyButton({ text, name }: { text: string; name: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try { await Clipboard.setStringAsync(text); } catch { return; }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2000);
  }
  return <Btn label={done ? t("Tersalin", "Copied") : t("Salin", "Copy")} icon={done ? "check" : "copy"} kind="ghost" onPress={copy} accessibilityLabel={t(`Salin alamat ${name}`, `Copy the ${name} address`)} />;
}

function WalletCard({ w }: { w: CryptoWallet }) {
  const c = useTheme();
  const t = useT();
  return (
    <Card style={{ gap: 12 }}>
      <T v="heading">{w.name}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {w.networks.map((n) => (
          <View key={n} style={{ backgroundColor: c.goldSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Text style={{ color: c.ink, fontFamily: font.sansSemi, fontSize: 12 }}>{n}</Text>
          </View>
        ))}
        {w.kind === "evm" ? (
          <View style={{ borderColor: c.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Text style={{ color: c.muted, fontFamily: font.sansSemi, fontSize: 12 }}>{t("dan jaringan EVM lainnya", "and other EVM networks")}</Text>
          </View>
        ) : null}
      </View>
      <Qr text={w.address} label={t(`Kode QR alamat ${w.name}`, `QR code of the ${w.name} address`)} />
      <View style={{ gap: 4 }}>
        <T v="small" muted>{t("Alamat dompet", "Wallet address")}</T>
        <View style={{ backgroundColor: c.bg, borderRadius: 10, padding: 10 }}>
          <Text selectable style={{ color: c.ink, fontFamily: font.mono, fontSize: 12.5, lineHeight: 19 }}>{w.address}</Text>
        </View>
      </View>
      <CopyButton text={w.address} name={w.name} />
    </Card>
  );
}

/** How to chip in toward Bandha's running costs (server, domain, email). */
export default function Donate() {
  const c = useTheme();
  const t = useT();
  return (
    <Screen>
      <View style={{ flexDirection: "row" }}><Btn label={t("Kembali", "Back")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{t("Dukung Bandha", "Support Bandha")}</T>
      <T muted>{t("Bandha dijalankan sendiri oleh satu orang. Donasi membantu membayar biaya infrastruktur: server (VPS), domain, dan layanan email. Donasi bersifat sukarela dan tidak membuka fitur apa pun.", "Bandha is run by one person. Donations help cover infrastructure costs: the server (VPS), the domain and the email service. They are voluntary and do not unlock any feature.")}</T>

      <Card style={{ gap: 12, alignItems: "center" }}>
        <T v="heading" accessibilityRole="header">QRIS</T>
        <T v="small" muted style={{ textAlign: "center" }}>{t("Pindai dengan aplikasi bank atau e-wallet apa pun, lalu isi nominal sesuka Anda.", "Scan it with any bank or e-wallet app, then enter whatever amount you like.")}</T>
        <View style={{ width: "100%", maxWidth: 360, aspectRatio: QRIS_RATIO, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: "#fff", overflow: "hidden" }}>
          <Image
            source={QRIS_IMAGE}
            accessibilityLabel={t(`Kode QRIS atas nama ${QRIS.merchant}`, `QRIS code for ${QRIS.merchant}`)}
            resizeMode="contain"
            style={{ width: "100%", height: "100%" }}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 28 }}>
          <View style={{ alignItems: "center" }}><T v="small" muted>{t("Penerima", "Recipient")}</T><Text style={{ color: c.ink, fontFamily: font.monoMedium, fontSize: 13 }}>{QRIS.merchant}</Text></View>
          <View style={{ alignItems: "center" }}><T v="small" muted>NMID</T><Text style={{ color: c.ink, fontFamily: font.monoMedium, fontSize: 13 }}>{QRIS.nmid}</Text></View>
        </View>
        <T v="small" muted style={{ textAlign: "center" }}>{t("Tidak bisa memindai layar sendiri? Tangkap layar kode ini, lalu pilih dari galeri di aplikasi bank atau e-wallet Anda.", "Cannot scan your own screen? Take a screenshot of this code, then pick it from the gallery inside your bank or e-wallet app.")}</T>
      </Card>

      <T v="heading" accessibilityRole="header" style={{ marginTop: 6 }}>{t("Kripto", "Crypto")}</T>
      <T v="small" muted>{t("Kirim ke alamat yang sesuai dengan jaringannya. Satu alamat Ethereum berlaku untuk semua jaringan EVM.", "Send to the address that matches the network. One Ethereum address works on every EVM network.")}</T>
      {DONATE_WALLETS.map((w) => <WalletCard key={w.kind} w={w} />)}

      <View style={{ backgroundColor: c.goldSoft, borderColor: c.gold, borderWidth: 1, borderRadius: 14, padding: 12 }}>
        <Text style={{ color: c.ink, fontFamily: font.sansMedium, fontSize: 13.5, lineHeight: 19 }}>
          {t("Periksa jaringan sebelum mengirim. Transfer kripto tidak bisa dibatalkan, dan token yang dikirim lewat jaringan yang salah bisa hilang.", "Check the network before you send. Crypto transfers cannot be undone, and tokens sent on the wrong network may be lost.")}
        </Text>
      </View>
      <T v="small" muted>{t("Donasi tidak tercatat sebagai transaksi di Bandha dan tidak memengaruhi data keuangan Anda.", "Donations are not recorded as transactions in Bandha and do not affect your financial data.")}</T>
      <T v="heading" color={c.sogan}>{t("Terima kasih sudah mendukung Bandha.", "Thank you for supporting Bandha.")}</T>
    </Screen>
  );
}
