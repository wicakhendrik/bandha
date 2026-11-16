import { router, Tabs } from "expo-router";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../src/i18n";
import { font, useTheme } from "../../../src/theme";
import { Icon } from "../../../src/ui";

export default function TabsLayout() {
  const c = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10) + 4;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#FFE7B5",
          tabBarInactiveTintColor: "#BFA98A",
          tabBarActiveBackgroundColor: "rgba(197,138,43,0.22)",
          tabBarLabelStyle: { fontFamily: font.sansSemi, fontSize: 10.5 },
          tabBarItemStyle: { borderRadius: 14, marginHorizontal: 2 },
          tabBarStyle: {
            position: "absolute", left: 12, right: 12, bottom, height: 62, paddingTop: 6, paddingBottom: 6,
            backgroundColor: c.walnut, borderRadius: 22, borderTopWidth: 0, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
            elevation: 12, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t("Beranda", "Home"), tabBarIcon: ({ color }) => <Icon name="home" color={color} size={21} /> }} />
        <Tabs.Screen name="accounts" options={{ title: t("Rekening", "Accounts"), tabBarIcon: ({ color }) => <Icon name="wallet" color={color} size={21} /> }} />
        <Tabs.Screen name="portfolio" options={{ title: t("Portofolio", "Portfolio"), tabBarIcon: ({ color }) => <Icon name="chart" color={color} size={21} /> }} />
        <Tabs.Screen name="transactions" options={{ title: t("Transaksi", "Transactions"), tabBarIcon: ({ color }) => <Icon name="swap" color={color} size={21} /> }} />
      </Tabs>
      <Pressable
        onPress={() => router.push("/add-transaction")}
        accessibilityRole="button"
        accessibilityLabel={t("Catat transaksi", "Add transaction")}
        style={({ pressed }) => ({
          position: "absolute", right: 22, bottom: bottom + 62 + 14, width: 56, height: 56, borderRadius: 18,
          backgroundColor: c.gold, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
          elevation: 8, shadowColor: c.gold, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
        })}
      >
        <Icon name="plus" color={c.walnut} size={26} />
      </Pressable>
    </View>
  );
}
