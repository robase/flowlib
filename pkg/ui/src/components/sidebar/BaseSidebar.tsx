import React from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import { ArrowLeft, Workflow, Clock, Users, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import type { FlowVersion } from '@flowlib/core/types';

interface BaseSidebarProps {
  title?: string;
  lastModified?: Date;
  author?: string;
  className?: string;
  children?: React.ReactNode;
  width?: 'narrow' | 'normal' | 'wide';
  backUrl?: string;
  backTitle?: string;
  versions?: FlowVersion[];
  currentVersion?: FlowVersion;
  onVersionChange?: (versionId: string) => void;
}

export const BaseSidebar: React.FC<BaseSidebarProps> = ({
  title = 'Untitled Flow',
  lastModified,
  author,
  className,
  children,
  width = 'normal',
  backUrl = '/',
  backTitle = 'Back to Home',
  versions = [],
  currentVersion,
  onVersionChange,
}) => {
  const widthClasses = {
    narrow: 'w-60',
    normal: 'w-72',
    wide: 'w-80',
  } as const;

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden bg-fl-background text-card-foreground border-r border-border shadow-[var(--fl-shadow-sidebar)]',
        widthClasses[width],
        className,
      )}
    >
      {/* Top Section */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          {/* Back Button */}
          <Link
            to={backUrl}
            className="flex items-center justify-center w-8 h-8 transition-colors rounded-md hover:bg-accent/50"
            title={backTitle}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          {/* Flow Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center min-w-0 gap-3">
              <div className="flex items-center justify-center w-8 h-8 border rounded-lg border-primary/20 bg-primary/10">
                <Workflow className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <h1 className="text-sm font-semibold line-clamp-1 text-card-foreground">{title}</h1>

                {/* Version Selector */}
                {versions.length > 0 && (
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="justify-start min-w-0 px-2 text-xs h-7 w-fit bg-card hover:bg-muted"
                        >
                          <span className="truncate">
                            v{currentVersion?.version || versions[0]?.version || 1}
                          </span>
                          <ChevronDown className="flex-shrink-0 w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56 overflow-y-auto max-h-48" align="start">
                        {versions.map((version) => (
                          <DropdownMenuItem
                            key={`${version.flowId}-${version.version}`}
                            onClick={() =>
                              onVersionChange?.(`${version.flowId}-${version.version}`)
                            }
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">v{version.version}</span>
                              {currentVersion?.version === version.version && (
                                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                  Current
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(version.createdAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: '2-digit',
                              })}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {author && (
                    <>
                      <Users className="w-3 h-3" />
                      <span>{author}</span>
                      <span>•</span>
                    </>
                  )}
                  {lastModified && (
                    <>
                      <Clock className="w-3 h-3" />
                      <span>{lastModified.toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex flex-col flex-1 gap-3 px-4 py-3 overflow-auto">{children}</div>
    </div>
  );
};
