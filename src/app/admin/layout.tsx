'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
    LayoutGrid,
    Users,
    ClipboardList,
    Calendar,
    MessageSquare,
    FileText,
    Phone,
    UserCheck,
    ChevronLeft,
    Menu,
    X,
    DollarSign,
    Heart,
    UserCog,
    UserPlus,
    Search,
    Activity,
    ListOrdered,
    Tag,
    Ban,
    Webhook,
    BarChart3,
    Settings,
    ListTodo,
    Moon,
    Sun,
} from 'lucide-react';

interface CapabilityModule {
    key: string;
    label: string;
    route: string;
    api: string;
    category: 'core' | 'whatsapp' | 'operations';
    enabled: boolean;
}

interface CapabilitiesResponse {
    success: boolean;
    modules: CapabilityModule[];
    whatsappHealth?: {
        bridgeRunning: boolean;
        connected: boolean;
        status: string;
    };
}

const ICON_BY_KEY: Record<string, any> = {
    dashboard: LayoutGrid,
    pacientes: Heart,
    avaliacoes: ClipboardList,
    orcamentos: DollarSign,
    precificacao: Settings,
    simulador: BarChart3,
    alocacoes: Calendar,
    candidatos: UserCheck,
    cuidadores: UserCog,
    usuarios: Users,
    logs: MessageSquare,
    leads: UserPlus,
    triagens: ListTodo,
    whatsapp: Phone,
    whatsapp_queue: ListOrdered,
    whatsapp_labels: Tag,
    whatsapp_blacklist: Ban,
    whatsapp_webhooks: Webhook,
    whatsapp_analytics: BarChart3,
    whatsapp_settings: Settings,
};

const FALLBACK_MODULES: CapabilityModule[] = [
    { key: 'dashboard', label: 'Dashboard', route: '/admin/dashboard', api: '/api/admin/dashboard/stats', category: 'core', enabled: true },
    { key: 'candidatos', label: 'Candidatos', route: '/admin/candidatos', api: '/api/admin/candidatos', category: 'operations', enabled: true },
    { key: 'cuidadores', label: 'Cuidadores', route: '/admin/cuidadores', api: '/api/admin/candidatos', category: 'operations', enabled: true },
    { key: 'pacientes', label: 'Pacientes', route: '/admin/pacientes', api: '/api/admin/pacientes', category: 'core', enabled: true },
    { key: 'avaliacoes', label: 'Avaliacoes', route: '/admin/avaliacoes', api: '/api/admin/avaliacoes', category: 'core', enabled: true },
    { key: 'orcamentos', label: 'Orcamentos', route: '/admin/orcamentos', api: '/api/admin/orcamentos', category: 'core', enabled: true },
    { key: 'leads', label: 'Leads', route: '/admin/leads', api: '/api/admin/leads', category: 'operations', enabled: true },
    { key: 'triagens', label: 'Triagens', route: '/admin/triagens', api: '/api/admin/whatsapp/flows', category: 'operations', enabled: true },
    { key: 'alocacoes', label: 'Alocacao', route: '/admin/alocacao', api: '/api/admin/alocacoes', category: 'operations', enabled: true },
    { key: 'precificacao', label: 'Precificação', route: '/admin/precificacao', api: '/api/admin/pricing-config', category: 'core', enabled: true },
    { key: 'simulador', label: 'Simulador', route: '/admin/simulador', api: '/api/admin/pricing-config', category: 'core', enabled: true },
    { key: 'usuarios', label: 'Usuarios', route: '/admin/usuarios', api: '/api/admin/usuarios', category: 'operations', enabled: true },
    { key: 'whatsapp', label: 'WhatsApp', route: '/admin/whatsapp', api: '/api/admin/whatsapp/contacts', category: 'whatsapp', enabled: true },
    { key: 'logs', label: 'Logs', route: '/admin/logs', api: '/api/admin/logs', category: 'operations', enabled: true },
];

const TOP_LEVEL_KEYS = new Set([
    'dashboard',
    'pacientes',
    'avaliacoes',
    'orcamentos',
    'precificacao',
    'simulador',
    'leads',
    'triagens',
    'alocacoes',
    'candidatos',
    'cuidadores',
    'usuarios',
    'whatsapp',
    'logs',
]);

const WHATSAPP_QUICK_LINKS = [
    { key: 'whatsapp_contacts', label: 'Contatos', route: '/admin/whatsapp/contacts' },
    { key: 'whatsapp_chat', label: 'Inbox', route: '/admin/whatsapp/chats' },
    { key: 'whatsapp_templates', label: 'Templates', route: '/admin/whatsapp/templates' },
    { key: 'whatsapp_quick_replies', label: 'Quick Replies', route: '/admin/whatsapp/quickreplies' },
    { key: 'whatsapp_autoreplies', label: 'Auto Replies', route: '/admin/whatsapp/autoreplies' },
    { key: 'whatsapp_scheduled', label: 'Scheduled', route: '/admin/whatsapp/scheduled' },
    { key: 'whatsapp_queue', label: 'Queue', route: '/admin/whatsapp/queue' },
    { key: 'whatsapp_labels', label: 'Labels', route: '/admin/whatsapp/labels' },
    { key: 'whatsapp_blacklist', label: 'Blacklist', route: '/admin/whatsapp/blacklist' },
    { key: 'whatsapp_webhooks', label: 'Webhooks', route: '/admin/whatsapp/webhooks' },
    { key: 'whatsapp_analytics', label: 'Analytics', route: '/admin/whatsapp/analytics' },
    { key: 'whatsapp_settings', label: 'Settings', route: '/admin/whatsapp/settings' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    // -- Dark mode --
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        const saved = localStorage.getItem('ma-theme');
        if (saved === 'dark') {
            setIsDark(true);
            document.documentElement.classList.add('dark');
        }
    }, []);
    const toggleTheme = useCallback(() => {
        setIsDark(prev => {
            const next = !prev;
            if (next) {
                document.documentElement.classList.add('dark');
                localStorage.setItem('ma-theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark');
                localStorage.setItem('ma-theme', 'light');
            }
            return next;
        });
    }, []);
    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
    const [globalSearch, setGlobalSearch] = useState('');

    // Close sidebar on Escape
    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (event.key === 'Escape' && sidebarOpen) {
                setSidebarOpen(false);
            }
        },
        [sidebarOpen]
    );

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    useEffect(() => {
        let active = true;

        async function fetchCapabilities() {
            try {
                const response = await fetch('/api/admin/capabilities', { cache: 'no-store' });
                if (!response.ok) return;
                const payload = await response.json();
                if (active && payload?.success) {
                    setCapabilities(payload);
                }
            } catch {
                // best effort
            }
        }

        fetchCapabilities();
    }, []);

    const modules = capabilities?.modules?.length
        ? capabilities.modules
        : FALLBACK_MODULES;

    const topLevelNav = useMemo(() => {
        return modules
            .filter((item) => item.enabled && TOP_LEVEL_KEYS.has(item.key))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [modules]);

    const whatsappModules = useMemo(() => {
        const enabledKeys = new Set(modules.filter((item) => item.enabled).map((item) => item.key));
        return WHATSAPP_QUICK_LINKS.filter((item) => enabledKeys.has(item.key));
    }, [modules]);

    const filteredTopLevel = useMemo(() => {
        const q = globalSearch.trim().toLowerCase();
        if (!q) return topLevelNav;
        return topLevelNav.filter((item) => item.label.toLowerCase().includes(q) || item.route.toLowerCase().includes(q));
    }, [topLevelNav, globalSearch]);

    const currentPageTitle = useMemo(() => {
        const current = modules.find((item) => pathname === item.route || pathname.startsWith(`${item.route}/`));
        if (current) return current.label;
        return 'Admin';
    }, [modules, pathname]);

    const waHealth = capabilities?.whatsappHealth;
    const waHealthText = waHealth
        ? waHealth.connected
            ? 'WhatsApp conectado'
            : waHealth.bridgeRunning
                ? `WhatsApp ${waHealth.status.toLowerCase()}`
                : 'Bridge offline'
        : 'Sem telemetria';

    const handleSearchNavigate = (value: string) => {
        const q = value.trim().toLowerCase();
        if (!q) return;

        const target = topLevelNav.find((item) => item.label.toLowerCase().includes(q) || item.route.toLowerCase().includes(q));
        if (target) {
            router.push(target.route);
            setSidebarOpen(false);
        }
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-background text-foreground font-sans">
            {/* ── Topbar ── */}
            <header className="fixed inset-x-0 top-0 z-30 h-14 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-sm">
                <div className="flex h-full items-center justify-between px-4 lg:px-6">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="rounded-sm p-2 text-muted-foreground hover:bg-surface-subtle lg:hidden transition-colors"
                            aria-label="Abrir menu de navegação"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <span className="hidden text-sm font-semibold text-muted-foreground lg:inline">Mãos Amigas</span>
                        <span className="hidden text-muted-foreground lg:inline">/</span>
                        <span className="text-sm font-semibold text-foreground">{currentPageTitle}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden w-64 lg:block">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <input
                                    value={globalSearch}
                                    onChange={(event) => setGlobalSearch(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            handleSearchNavigate(globalSearch);
                                        }
                                    }}
                                    placeholder="Buscar modulo..."
                                    className="h-9 w-full rounded-md border border-border bg-input pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all placeholder:text-muted-foreground"
                                />
                            </div>
                        </div>
                        <div className="hidden items-center gap-2 rounded-full bg-surface-subtle px-3 py-1 text-xs text-foreground lg:flex">
                            <Activity className="h-3.5 w-3.5" />
                            {waHealthText}
                        </div>
                        <button
                            onClick={toggleTheme}
                            className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-surface-subtle hover:text-foreground transition-colors focus:ring-2 focus:ring-ring focus:outline-none"
                            aria-label={isDark ? 'Modo claro' : 'Modo escuro'}
                        >
                            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </button>

                        <div className="ml-2 flex items-center gap-3 pl-3 border-l border-border">
                            <div className="text-right hidden xl:block">
                                <div className="text-sm font-medium text-foreground">Admin User</div>
                                <div className="text-xs text-muted-foreground">Gestor</div>
                            </div>
                            <button className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold border border-primary/20 focus:ring-2 focus:ring-ring focus:outline-none transition-shadow">
                                AD
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* ── Sidebar Overlay ── */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* ── Sidebar (Enterprise Navy) ── */}
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-50 w-72 border-r border-navy-800 bg-navy-900 shadow-xl transition-transform duration-200 ease-in-out lg:translate-x-0',
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                )}
                role="navigation"
                aria-label="Menu principal"
            >
                <div className="flex h-14 items-center justify-between border-b border-navy-800 px-5">
                    <Link href="/admin/dashboard" className="flex items-center gap-2 group">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-900/40 group-hover:shadow-primary-500/20 transition-all">
                            <Heart className="h-4.5 w-4.5 text-white" />
                        </div>
                        <span className="font-bold text-white tracking-tight text-lg">Mãos Amigas</span>
                    </Link>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="rounded-sm p-2 text-navy-300 hover:bg-navy-800 hover:text-white lg:hidden transition-colors"
                        aria-label="Fechar menu"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="h-[calc(100%-56px)] overflow-y-auto px-3 py-6">
                    <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-widest text-navy-400">
                        Navegação
                    </div>
                    <nav className="space-y-1">
                        {filteredTopLevel.map((item) => {
                            const Icon = ICON_BY_KEY[item.key] || FileText;
                            const isDashboard = item.key === 'dashboard';
                            // Dashboard needs exact match to avoid staying active on sub-routes
                            const isActive = isDashboard
                                ? pathname === item.route
                                : pathname === item.route || pathname.startsWith(`${item.route}/`);

                            return (
                                <Link
                                    key={item.key}
                                    href={item.route}
                                    onClick={() => setSidebarOpen(false)}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={cn(
                                        'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 group',
                                        isActive
                                            ? 'bg-primary text-primary-foreground shadow-md shadow-primary-900/20'
                                            : 'text-navy-200 hover:bg-card/10 hover:text-white'
                                    )}
                                >
                                    <Icon className={cn('h-[18px] w-[18px] transition-colors', isActive ? 'text-primary-foreground' : 'text-navy-400 group-hover:text-white')} />
                                    <span>{item.label}</span>
                                    {isActive && (
                                        <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-card/30" />
                                    )}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-8 mb-2 px-3 text-[11px] font-bold uppercase tracking-widest text-navy-400">
                        WhatsApp
                    </div>
                    <nav className="space-y-1">
                        {whatsappModules.map((item) => {
                            const Icon = ICON_BY_KEY[item.key] || Phone;
                            const isActive = pathname === item.route || pathname.startsWith(`${item.route}/`);
                            return (
                                <Link
                                    key={item.key}
                                    href={item.route}
                                    onClick={() => setSidebarOpen(false)}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={cn(
                                        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 group',
                                        isActive
                                            ? 'bg-card/10 text-white'
                                            : 'text-navy-300 hover:bg-card/5 hover:text-white'
                                    )}
                                >
                                    <Icon className={cn('h-4 w-4 transition-colors', isActive ? 'text-primary-400' : 'text-navy-500 group-hover:text-primary-400')} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-8 border-t border-white/10 pt-4">
                        <Link
                            href="/"
                            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-navy-400 hover:bg-card/5 hover:text-white transition-colors"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Voltar ao site
                        </Link>
                    </div>
                </div>
            </aside>

            {/* ── Main Content ── */}
            <main className="flex-1 pt-14 lg:pl-72">
                <div className="mx-auto max-w-screen-2xl">
                    {children}
                </div>
            </main>
        </div>
    );
}
