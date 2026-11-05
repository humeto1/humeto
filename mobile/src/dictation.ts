import { Capacitor, registerPlugin } from "@capacitor/core";

const Device = registerPlugin<{
  dictateInstruction(): Promise<{ text: string }>;
}>("HumetoDevice");

export const nativeDictateInstruction =
  Capacitor.getPlatform() === "android"
    ? async () => (await Device.dictateInstruction()).text
    : undefined;
