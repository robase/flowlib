import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight, Home, FileText, KeyRound, Sun, Moon } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../ui/tooltip';
import { useTheme } from '~/contexts/ThemeProvider';
import { usePluginRegistry } from '~/contexts/PluginRegistryContext';
import { buildFrontendRoute } from '~/contexts/FrontendPathContext';
import { FlowlibLogo } from '../shared/FlowlibLogo';

export interface AppSideMenuProps {
  basePath?: string;
}

export function AppSideMenu({ basePath = '' }: AppSideMenuProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [tooltipsEnabled, setTooltipsEnabled] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const registry = usePluginRegistry();

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  // Build hrefs through buildFrontendRoute so a basePath of `/` (root-mounted
  // hosting) doesn't produce `//profile`-style protocol-relative URLs that
  // browsers interpret as `http://profile/`. Home stays at the bare basePath
  // (or `/` for root-mounted) so the isHome equality check below works.
  // Strip a lone trailing `/` from basePath; keep `/` itself as `/`.
  const homeHref = basePath && basePath !== '/' ? basePath.replace(/\/$/, '') : '/';
  const menuItems = [
    { icon: Home, label: 'Home', href: homeHref },
    { icon: FileText, label: 'Flow Runs', href: buildFrontendRoute(basePath, '/flow-runs') },
    { icon: KeyRound, label: 'Credentials', href: buildFrontendRoute(basePath, '/credentials') },
  ];

  // Plugin-contributed sidebar items (top position = after defaults)
  const pluginTopItems = registry.sidebarItems
    .filter((item) => item.position !== 'bottom')
    .filter((item) => !item.permission || registry.checkPermission(item.permission))
    .map((item) => ({
      icon: item.icon,
      label: item.label,
      href: buildFrontendRoute(basePath, item.path),
    }));

  const pluginBottomItems = registry.sidebarItems
    .filter((item) => item.position === 'bottom')
    .filter((item) => !item.permission || registry.checkPermission(item.permission))
    .map((item) => ({
      icon: item.icon,
      label: item.label,
      href: buildFrontendRoute(basePath, item.path),
    }));

  const allMainItems = [...menuItems, ...pluginTopItems];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        !isCollapsed &&
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target as Node)
      ) {
        setIsCollapsed(true);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCollapsed]);

  useEffect(() => {
    setTooltipsEnabled(false);

    if (!isCollapsed) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTooltipsEnabled(true);
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCollapsed]);

  return (
    <div className="relative w-16 shrink-0">
      <div
        ref={sidebarRef}
        className={cn(
          'imp-sidebar-shell absolute left-0 top-0 z-50 flex h-full flex-col border-r border-imp-border bg-imp-sidebar text-imp-sidebar-foreground transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-64',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute z-10 w-6 h-6 border rounded-full -right-3 top-4 border-imp-border bg-imp-background"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>

        {/* Sidebar content */}
        <div className="flex items-center px-4 border-b h-14 border-border">
          {isCollapsed ? (
            <button
              onClick={() => setIsCollapsed(false)}
              className="flex items-center justify-center w-8 h-8 transition-opacity rounded cursor-pointer text-primary-foreground hover:opacity-90"
            >
              <FlowlibLogo iconClassName="h-6" />
            </button>
          ) : (
            <FlowlibLogo
              showLabel
              className="pl-2.5"
              iconClassName="h-6"
              // labelClassName="text-lg font-semibold"
            />
          )}
        </div>

        {/* Menu items */}
        <TooltipProvider>
          <nav className="flex-1 p-2 space-y-1">
            {allMainItems.map((item) => {
              const isHome = item.href === basePath || item.href === '/';
              const isActive = isHome
                ? location.pathname === item.href
                : location.pathname.startsWith(item.href);

              if (!tooltipsEnabled) {
                return (
                  <Link key={item.label} to={item.href} aria-label={item.label}>
                    <Button
                      variant={isActive ? 'secondary' : 'ghost'}
                      className="justify-start w-full px-0"
                    >
                      <span className="flex items-center justify-center w-12 shrink-0">
                        <item.icon className="w-5 h-5" />
                      </span>
                      {!isCollapsed && <span>{item.label}</span>}
                    </Button>
                  </Link>
                );
              }
              return (
                <Tooltip key={item.label} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link to={item.href} aria-label={item.label}>
                      <Button
                        variant={isActive ? 'secondary' : 'ghost'}
                        className="justify-start w-full px-0"
                      >
                        <span className="flex items-center justify-center w-12 shrink-0">
                          <item.icon className="w-5 h-5" />
                        </span>
                        {!isCollapsed && <span>{item.label}</span>}
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent side="right" sideOffset={16}>
                      <p>{item.label}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </nav>

          {/* Plugin bottom sidebar items + Dark Mode Toggle */}
          <div className="p-2 space-y-1 border-t border-border">
            {pluginBottomItems.map((item) => {
              const isActive = location.pathname.startsWith(item.href);
              if (!tooltipsEnabled) {
                return (
                  <Link key={item.label} to={item.href} aria-label={item.label}>
                    <Button
                      variant={isActive ? 'secondary' : 'ghost'}
                      className="justify-start w-full px-0"
                    >
                      <span className="flex items-center justify-center w-12 shrink-0">
                        <item.icon className="w-5 h-5" />
                      </span>
                      {!isCollapsed && <span>{item.label}</span>}
                    </Button>
                  </Link>
                );
              }
              return (
                <Tooltip key={item.label} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link to={item.href} aria-label={item.label}>
                      <Button
                        variant={isActive ? 'secondary' : 'ghost'}
                        className="justify-start w-full px-0"
                      >
                        <span className="flex items-center justify-center w-12 shrink-0">
                          <item.icon className="w-5 h-5" />
                        </span>
                        {!isCollapsed && <span>{item.label}</span>}
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent side="right" sideOffset={16}>
                      <p>{item.label}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
            {tooltipsEnabled ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={toggleTheme}
                    className="justify-start w-full px-0"
                  >
                    <span className="flex items-center justify-center w-12 shrink-0">
                      {resolvedTheme === 'dark' ? (
                        <Sun className="w-5 h-5" />
                      ) : (
                        <Moon className="w-5 h-5" />
                      )}
                    </span>
                    {!isCollapsed && (
                      <span>{resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    )}
                  </Button>
                </TooltipTrigger>
                {isCollapsed && (
                  <TooltipContent side="right" sideOffset={16}>
                    <p>{resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            ) : (
              <Button variant="ghost" onClick={toggleTheme} className="justify-start w-full px-0">
                <span className="flex items-center justify-center w-12 shrink-0">
                  {resolvedTheme === 'dark' ? (
                    <Sun className="w-5 h-5" />
                  ) : (
                    <Moon className="w-5 h-5" />
                  )}
                </span>
                {!isCollapsed && (
                  <span>{resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                )}
              </Button>
            )}
          </div>

          {/* Plugin sidebar footer (e.g. user menu) */}
          {registry.SidebarFooter && (
            <div className="p-2 border-t border-border">
              <registry.SidebarFooter collapsed={isCollapsed} basePath={basePath} />
            </div>
          )}
        </TooltipProvider>
      </div>
    </div>
  );
}
