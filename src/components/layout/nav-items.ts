import { History, Inbox, LayoutDashboard, MessageCircle, Receipt, Settings, Users, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/cobrancas", label: "Cobranças", icon: Receipt },
  { href: "/historico", label: "Histórico", icon: History },
  { href: "/respostas", label: "Respostas", icon: Inbox },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];
