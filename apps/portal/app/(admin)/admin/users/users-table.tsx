"use client";

import { useState, useTransition } from "react";
import { UserRound, UserPlus, MoreHorizontal, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUserAction,
  resetPasswordAction,
  updateUserAction,
  hardDeleteUserAction,
} from "./actions";
import { PasswordInput } from "@/components/ui/password-input";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: "ADMIN" | "AGENT" | "OWNER";
  status: "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";
  active: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
};

type Props = {
  readonly users: UserRow[];
  readonly actorId: string;
};

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createUserAction({
        email: String(formData.get("email") ?? ""),
        full_name: String(formData.get("full_name") ?? ""),
        role: String(formData.get("role") ?? ""),
        tempPassword: String(formData.get("tempPassword") ?? ""),
      });

      if (result.ok) {
        toast.success("User created. Share their temporary password — they'll set their own at first sign-in.");
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            Set a temporary password and share it with them. They&apos;ll be
            asked to choose their own at first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input id="create-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Full name</Label>
            <Input id="create-name" name="full_name" type="text" required autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-role">Role</Label>
            <Select name="role" defaultValue="AGENT">
              <SelectTrigger id="create-role">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-password">Temporary password</Label>
            <PasswordInput
              id="create-password"
              name="tempPassword"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-text-muted">At least 8 characters.</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSheet(props: {
  user: UserRow;
  actorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isSelf = props.user.id === props.actorId;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState(props.user.full_name);
  const [role, setRole] = useState<UserRow["role"]>(props.user.role);
  const [active, setActive] = useState(props.user.active);

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateUserAction({
        targetUserId: props.user.id,
        full_name: fullName,
        role: isSelf ? undefined : role,
        active: isSelf ? undefined : active,
      });

      if (result.ok) {
        toast.success("User updated");
        props.onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {props.user.full_name}</SheetTitle>
          <SheetDescription>
            {isSelf
              ? "You can edit your name. Role and active status are locked for your own account."
              : "Update the user's name, role, or active status."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Full name</Label>
            <Input
              id="edit-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRow["role"])}
              disabled={isSelf}
            >
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-active" className="flex flex-col gap-0.5">
              <span>Active</span>
              <span className="text-xs text-text-muted">
                Inactive users can&apos;t sign in.
              </span>
            </Label>
            <Switch
              id="edit-active"
              checked={active}
              onCheckedChange={setActive}
              disabled={isSelf}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ResetPasswordDialog(props: {
  user: UserRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await resetPasswordAction({
        targetUserId: props.user.id,
        tempPassword: String(formData.get("tempPassword") ?? ""),
      });
      if (result.ok) {
        toast.success("Password reset. Share the temporary password — they'll set a new one at next sign-in.");
        props.onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) setError(null); props.onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {props.user.full_name}</DialogTitle>
          <DialogDescription>
            Set a temporary password and share it with them. They&apos;ll be
            asked to choose a new one at next sign-in.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">Temporary password</Label>
            <PasswordInput
              id="reset-password"
              name="tempPassword"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-text-muted">At least 8 characters.</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ user, actorId }: { user: UserRow; actorId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmEmail, setConfirmEmail] = useState("");
  const isSelf = user.id === actorId;

  function onToggleActive() {
    startTransition(async () => {
      const result = await updateUserAction({
        targetUserId: user.id,
        active: !user.active,
      });
      if (result.ok) {
        toast.success(user.active ? "User deactivated" : "User reactivated");
        setDeactivateOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function onHardDelete() {
    startTransition(async () => {
      const result = await hardDeleteUserAction({
        targetUserId: user.id,
        confirmEmail,
      });
      if (result.ok) {
        toast.success("User deleted permanently");
        setDeleteOpen(false);
        setConfirmEmail("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setResetOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Reset password
          </DropdownMenuItem>
          {!isSelf ? (
            <DropdownMenuItem onSelect={() => setDeactivateOpen(true)}>
              {user.active ? "Deactivate" : "Reactivate"}
            </DropdownMenuItem>
          ) : null}
          {!isSelf ? (
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              Delete permanently
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditSheet
        user={user}
        actorId={actorId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ResetPasswordDialog
        user={user}
        open={resetOpen}
        onOpenChange={setResetOpen}
      />

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {user.active ? "Deactivate" : "Reactivate"} {user.full_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {user.active
                ? "They won't be able to sign in until reactivated."
                : "They'll be able to sign in again immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onToggleActive} disabled={pending}>
              {pending
                ? "Working…"
                : user.active
                  ? "Deactivate"
                  : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setConfirmEmail("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {user.full_name} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This wipes the user from Supabase Auth and the profile. Audit
              rows they authored will keep the action but lose the actor
              identity. Type their email to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={user.email}
            autoComplete="off"
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onHardDelete}
              disabled={
                pending ||
                confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function UsersTable({ users, actorId }: Props) {
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <CreateUserDialog />
      </div>

      {users.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            icon={UserRound}
            title={copy.empty.adminUsers.title}
            description={copy.empty.adminUsers.description}
            action={<CreateUserDialog />}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Name</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Email</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Role</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Status</TableHead>
                <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Presence</TableHead>
                <TableHead className="text-right font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium text-foreground">
                    {u.full_name}
                  </TableCell>
                  <TableCell className="text-text-muted">{u.email}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-pill bg-muted px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground">
                      {u.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    {!u.active ? (
                      <span className="inline-flex items-center rounded-pill bg-muted px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        Deactivated
                      </span>
                    ) : u.must_change_password ? (
                      <span className="inline-flex items-center rounded-pill bg-attention/15 px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-attention-text">
                        Pending setup
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-pill bg-live/15 px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-live-foreground">
                        Active
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-muted text-xs">{u.status}</TableCell>
                  <TableCell className="text-right">
                    <RowActions user={u} actorId={actorId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
