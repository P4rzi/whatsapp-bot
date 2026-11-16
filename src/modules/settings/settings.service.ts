import { prisma } from "@/lib/prisma";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/modules/messaging/template";

export async function saveDefaultMessageTemplate(template: string) {
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", defaultMessageTemplate: template },
    update: { defaultMessageTemplate: template },
  });
}

export async function getDefaultMessageTemplate(): Promise<string> {
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  return settings?.defaultMessageTemplate ?? DEFAULT_MESSAGE_TEMPLATE;
}
