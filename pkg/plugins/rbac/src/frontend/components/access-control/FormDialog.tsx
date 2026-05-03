import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@flowlib/ui';

export function FormDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md p-4 border-fl-border bg-fl-background text-fl-foreground sm:max-w-md">
        <DialogHeader className="mb-1">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
