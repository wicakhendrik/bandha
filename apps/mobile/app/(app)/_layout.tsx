import { Stack } from "expo-router";

export const unstable_settings = { anchor: "(tabs)" };

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="asset/[assetId]" />
      <Stack.Screen name="account/[accountId]" />
      <Stack.Screen name="add-transaction" options={{ presentation: "modal" }} />
      <Stack.Screen name="add-account" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" />
      <Stack.Screen name="donate" />
      <Stack.Screen name="debts" />
      <Stack.Screen name="import-csv" />
      <Stack.Screen name="debt/[id]" />
      <Stack.Screen name="add-debt" options={{ presentation: "modal" }} />
      <Stack.Screen name="settle-debt" options={{ presentation: "modal" }} />
    </Stack>
  );
}
