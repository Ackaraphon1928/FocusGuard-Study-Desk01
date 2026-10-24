import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowRight, Bell, ChartNoAxesCombined, ChevronRight, Clock3, Cpu, Download, FlaskConical, Grid2X2, Leaf, Menu, ShieldCheck, SlidersHorizontal, Sprout, X } from 'lucide-react';
import { useDesk, useEvents } from './lib/queries';
import { exportUrl } from './lib/api';
import { formatDate } from './lib/format';
import { Badge, Button, Card, ErrorNotice, LoadingState, Modal } from './components/ui';
import { DemoLab } from './components/DemoLab';
import { EventsList } from './components/EventsList';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then(module => ({ default: module.OverviewPage })));
const SessionsPage = lazy(() => import('./pages/SessionsPage').then(module => ({ default: module.SessionsPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(module => ({ default: module.AnalyticsPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then(module => ({ default: module.DevicesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));

const navigation = [
  { path: '/overview', label: 'Overview', icon: Grid2X2 },
  { path: '/sessions', label: 'Session history', icon: Clock3 },
  { path: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { path: '/devices', label: 'Devices & network', icon: Cpu },
  { path: '/settings', label: 'Rules & settings', icon: SlidersHorizontal },
];
const headings: Record<string, {eyebrow: string; title: string; description: string}> = {
  '/overview': { eyebrow: 'YOUR SPACE. YOUR PACE.', title: 'A good space for good work.', description: 'A little awareness goes a long way. Here’s how your desk is doing.' },
  '/sessions': { eyebrow: 'SMALL HABITS. LASTING CHANGE.', title: 'Every session tells a story.', description: 'Look back at your time, your conditions, and the habits you’re building.' },
  '/analytics': { eyebrow: 'THE BIGGER PICTURE', title: 'Make room for better habits.', description: 'Explore the patterns in your environment and your study sessions.' },
  '/devices': { eyebrow: 'CONNECTED, THOUGHTFULLY', title: 'Meet your desk’s little helpers.', description: 'Two sensor nodes, one local gateway, and a connected view of your space.' },
  '/settings': { eyebrow: 'MAKE IT YOUR OWN', title: 'A desk that works your way.', description: 'Tune the rules, reminders, and privacy choices for your study space.' },
};

class PageErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Card className="p-8"><h2 className="text-lg font-semibold">This view needs a fresh start.</h2><p className="mt-3 text-sm text-muted">Your monitoring service continues running. Reload the dashboard to reconnect.</p><Button className="mt-5" onClick={() => window.location.reload()}>Reload dashboard</Button></Card> : this.props.children;
  }
}

export function App() {
  const location = useLocation();
  const desk = useDesk();
  const state = desk.data;
  const mode = state?.mode ?? 'demo';
  const events = useEvents(mode);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const heading = headings[location.pathname] ?? headings['/overview']!;
  const pageLabel = navigation.find(item => item.path === location.pathname)?.label ?? 'Overview';

  useEffect(() => {
    document.title = `${pageLabel} · FocusGuard`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pageLabel]);

  return <>
    <a href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }} className="fixed top-2 left-2 z-100 -translate-y-24 rounded-lg bg-white p-3 text-pine shadow-lg focus:translate-y-0">Skip to content</a>
    {sidebarOpen && <button aria-label="Close navigation backdrop" className="fixed inset-0 z-30 bg-pine-dark/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    <aside id="workspace-navigation" className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-white px-5 pt-8 transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between"><Link to="/overview" onClick={() => setSidebarOpen(false)} aria-label="FocusGuard home" className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl rounded-bl-sm bg-pine-dark text-lime"><Leaf className="size-6" /></span><span className="text-2xl font-bold tracking-[-1px]">focusguard<span className="text-sage">.</span><small className="mt-1 block text-[7px] font-medium tracking-[2px] text-muted">A LITTLE MORE BALANCE</small></span></Link><button className="rounded-lg p-1 text-muted lg:hidden" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X className="size-4" /></button></div>
      <div className="mt-8 flex items-center gap-3 rounded-xl border border-line p-3"><div className="grid size-8 place-items-center rounded-lg bg-sage-light text-sage"><Sprout className="size-4" /></div><div><p className="text-xs font-semibold">My study space</p><p className="mt-1 text-[10px] text-muted">Personal workspace</p></div><span className="ml-auto size-1.5 rounded-full bg-sage" /></div>
      <p className="mt-8 px-3 text-[9px] font-semibold tracking-[1.5px] text-muted/75">WORKSPACE</p>
      <nav aria-label="Main navigation" className="mt-3 space-y-1">{navigation.map(({ path, label, icon: Icon }) => <div key={path}>{path === '/settings' && <p className="mt-7 mb-3 px-3 text-[9px] font-semibold tracking-[1.5px] text-muted/75">PREFERENCES</p>}<NavLink to={path} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-3 text-xs transition-colors ${isActive ? 'bg-sage-light font-semibold text-pine' : 'text-muted hover:bg-canvas hover:text-ink'}`}><Icon className="size-[17px]" />{label}<span className="ml-auto hidden size-1.5 rounded-full bg-pine group-aria-[current=page]:block" /></NavLink></div>)}</nav>
      <div className="mt-auto pt-8"><div className="rounded-xl border border-line bg-[#f5f7ef] p-4"><ShieldCheck className="mb-3 size-5 text-sage" /><h2 className="text-[11px] font-semibold">Designed for your privacy</h2><p className="mt-2 text-[10px] leading-6 text-muted">Your camera stays local.<br />Only insights leave your desk.</p><button onClick={() => setPrivacyOpen(true)} className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-pine">How it works<ArrowRight className="size-3" /></button></div><div className="mt-5 flex items-center gap-2.5 border-t border-line py-5"><span className="grid size-8 place-items-center rounded-full bg-[#e9dfcc] text-xs font-semibold text-[#7e6d50]">Y</span><div><p className="text-[11px] font-medium">Your workspace</p><p className="mt-1 text-[9px] text-muted">FocusGuard prototype</p></div><span className="ml-auto text-[9px] text-muted/70">v2.0</span></div></div>
    </aside>
    <div className="lg:ml-60">
      <header className="flex h-[72px] items-center justify-between border-b border-line bg-white px-5 sm:px-8 xl:px-10"><div className="flex items-center gap-3 text-[11px] text-muted"><button aria-label="Toggle navigation" aria-controls="workspace-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)} className="rounded-lg p-1.5 lg:hidden"><Menu className="size-5" /></button><span className="hidden sm:inline">Workspace</span><ChevronRight className="hidden size-3 text-muted/50 sm:block" /><span className="text-ink">{pageLabel}</span></div><div className="flex items-center gap-5"><span className="hidden items-center gap-1.5 text-[10px] text-muted sm:inline-flex"><span className="size-1.5 rounded-full bg-sage" />Local-first</span><button aria-label="View recent events" onClick={() => setEventsOpen(true)} className="relative rounded-lg p-2 text-muted hover:bg-sage-light"><Bell className="size-[18px]" />{state?.events.some(event => event.severity !== 'info') && <span className="absolute top-1 right-1 size-1.5 rounded-full border border-white bg-amber-500" />}</button><span className="grid size-7 place-items-center rounded-full bg-[#e9dfcc] text-[11px] font-semibold text-[#7e6d50]">Y</span></div></header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1700px] px-5 pt-8 outline-none sm:px-8 xl:px-10">
        {desk.isError && <div className="mb-6"><ErrorNotice error={new Error(state ? 'Reconnecting to your desk. The last received readings are shown below.' : 'The local monitoring service is unavailable. Start the API, then this page will reconnect automatically.')} /></div>}
        <div className="mb-7 flex items-end justify-between gap-5"><div><p className="mb-2 text-[9px] font-semibold tracking-[1.6px] text-sage">{heading.eyebrow}</p><h1 className="text-[27px] font-semibold tracking-[-1px] sm:text-[30px]">{heading.title}</h1><p className="mt-2.5 max-w-xl text-xs leading-6 text-muted">{heading.description}</p></div><div className="flex shrink-0 items-center gap-4"><time className="hidden text-[10px] text-muted xl:block">{formatDate(new Date().toISOString())}</time><a aria-label="Export data" href={exportUrl(location.pathname === '/sessions' ? 'sessions' : 'history', mode)} download className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-medium text-muted transition-colors hover:bg-sage-light"><Download className="size-4" /><span className="hidden sm:inline">Export data</span></a></div></div>
        {state?.mode === 'demo' && <div className="mb-7 flex items-center justify-between gap-4 rounded-xl border border-[#e2e8d4] bg-[#f0f3e6] p-3.5"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e2e9d2] text-[#7b8b59]"><FlaskConical className="size-4" /></span><div><p className="text-[11px] font-semibold text-[#62764c]">You’re exploring the demo workspace</p><p className="mt-1 text-[10px] leading-5 text-muted">Live simulated sensors. Real rules, sessions, and insights.</p></div></div><Button variant="secondary" className="shrink-0 bg-white text-[10px]" onClick={() => setDemoOpen(true)}>Try a scenario<ArrowRight className="hidden sm:block" /></Button></div>}
        <PageErrorBoundary key={location.pathname}><Suspense fallback={<LoadingState message="Opening your workspace…" />}><Routes><Route path="/overview" element={<OverviewPage />} /><Route path="/sessions" element={<SessionsPage />} /><Route path="/analytics" element={<AnalyticsPage />} /><Route path="/devices" element={<DevicesPage />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/overview" replace />} /></Routes></Suspense></PageErrorBoundary>
        <footer className="flex flex-wrap items-center justify-between gap-3 py-6 text-[9px] text-muted/75"><span className="flex items-center gap-1.5"><span className={`size-1 rounded-full ${desk.isError ? 'bg-amber-500' : 'bg-sage'}`} />{desk.isError ? 'Local service disconnected' : state ? `${mode === 'demo' ? 'Demo workspace' : 'Local monitoring'} · metadata only` : 'Connecting to local service'}</span><span className="hidden sm:inline">Thoughtful technology. A better study space.</span></footer>
      </main>
    </div>
    <DemoLab open={demoOpen && mode === 'demo'} onClose={() => setDemoOpen(false)} />
    <Modal open={eventsOpen} onClose={() => setEventsOpen(false)} title="Around your desk" description="The latest recorded events in your current workspace."><ErrorNotice error={events.error} /><EventsList events={events.data ?? state?.events ?? []} limit={100} /><p className="mt-4 text-xs text-muted">{mode === 'demo' ? 'Simulated' : 'Hardware'} events · stored locally</p></Modal>
    <Modal open={privacyOpen} onClose={() => setPrivacyOpen(false)} title="Your camera stays at your desk." description="FocusGuard processes video on your Raspberry Pi and shares only derived posture features."><div className="my-6 flex flex-wrap items-center gap-2 text-xs text-pine"><Badge>Camera · local only</Badge><ArrowRight className="size-3" /><Badge>Pose metadata</Badge><ArrowRight className="size-3" /><Badge>Your dashboard</Badge></div><div className="space-y-5 text-sm leading-7 text-muted"><section><h3 className="mb-2 font-semibold text-ink">No conversation recording</h3><p>The sound module provides relative amplitude. It does not record conversations or transcribe speech.</p></section><section><h3 className="mb-2 font-semibold text-ink">A choice about cloud AI</h3><p>Cloud summaries are off by default. When enabled, AWS Bedrock receives aggregate session statistics. Camera frames and audio are never sent. Local controls continue without Internet access.</p></section><section><h3 className="mb-2 font-semibold text-ink">Honest about what we know</h3><p>The Study Condition Score describes observed desk conditions. It does not infer mental focus or diagnose health.</p></section></div><Link to="/settings" onClick={() => setPrivacyOpen(false)} className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-pine">Review privacy settings<ArrowRight className="size-4" /></Link></Modal>
  </>;
}
