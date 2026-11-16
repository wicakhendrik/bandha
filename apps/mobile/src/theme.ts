import { useColorScheme } from "react-native";

export interface Palette {
  bg: string; card: string; mori: string; line: string; ink: string; muted: string;
  sogan: string; gold: string; goldSoft: string; pos: string; neg: string; daun: string; bata: string;
  walnut: string; onPrimary: string; primary: string;
}

// "Batik Sogan": warm browns, cream paper, gold accents.
const light: Palette = {
  bg: "#FBF6EC", card: "#FFFDF8", mori: "#F5EDE0", line: "#E6D8C3", ink: "#2A1A10", muted: "#7D6650",
  sogan: "#5C3A21", gold: "#C58A2B", goldSoft: "#F1DDB4", pos: "#4F7338", neg: "#A8472D", daun: "#5B7A45", bata: "#A8472D",
  walnut: "#2A1A10", onPrimary: "#FFF4DC", primary: "#5C3A21",
};
const dark: Palette = {
  bg: "#1E130C", card: "#2A1B12", mori: "#33221A", line: "#4A3426", ink: "#F3E8D6", muted: "#B79C80",
  sogan: "#E7CFA3", gold: "#C58A2B", goldSoft: "#4A3517", pos: "#8DB36F", neg: "#E0805F", daun: "#5B7A45", bata: "#A8472D",
  walnut: "#2A1A10", onPrimary: "#2A1A10", primary: "#C58A2B",
};

export const useTheme = (): Palette => (useColorScheme() === "dark" ? dark : light);

export const font = {
  serif: "Fraunces_600SemiBold",
  sans: "PlusJakartaSans_400Regular",
  sansMedium: "PlusJakartaSans_500Medium",
  sansSemi: "PlusJakartaSans_600SemiBold",
  sansBold: "PlusJakartaSans_700Bold",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
} as const;

export const SLICE = ["#5C3A21", "#C58A2B", "#5B7A45", "#A8472D", "#8A6D56", "#2F6F6F", "#7A5A9C", "#B9A58C"];
