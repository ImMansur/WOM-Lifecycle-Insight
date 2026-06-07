import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, createUser, deleteUser, type UserProfile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Users,
  Plus,
  Trash2,
  Shield,
  Info,
  Lock,
  Mail,
  User,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";

export const Route = createFileRoute("/users")({
  component: UsersPage,
});

// UserMenu component moved to __root.tsx layout wrapper

function UsersPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("Analysis");
  const [formError, setFormError] = useState<string | null>(null);

  // Direct access check
  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role !== "Fleet Manager" && user.role !== "System Administrator") {
        // Redirect non-admins out of user management
        if (user.role === "Uploader") {
          navigate({ to: "/upload" });
        } else {
          navigate({ to: "/dashboard" });
        }
      }
    }
  }, [user, loading, navigate]);

  const { data: users = [], isLoading, isError, error } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: !!user && (user.role === "Fleet Manager" || user.role === "System Administrator"),
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      addNotification({
        fileName: "User Management",
        status: "success",
        message: `Registered new user: ${newUser.displayName}`,
      });
      // Reset form
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("Analysis");
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      addNotification({
        fileName: "User Management",
        status: "success",
        message: `Deleted user: ${userToDelete?.displayName}`,
      });
      setUserToDelete(null);
      setDeleteConfirmOpen(false);
    },
    onError: (err: Error) => {
      addNotification({
        fileName: "User Management",
        status: "error",
        message: `Delete failed: ${err.message}`,
      });
    },
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !password || !displayName.trim()) {
      setFormError("All fields are required.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    createMutation.mutate({
      email: email.trim(),
      password,
      displayName: displayName.trim(),
      role,
    });
  };

  const handleDeleteUser = () => {
    if (userToDelete) {
      deleteMutation.mutate(userToDelete.uid);
    }
  };

  if (loading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-[1600px] w-full mx-auto p-6 md:p-8 space-y-8 relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-black tracking-tight">
              User Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Add and configure access credentials and system permission roles.
            </p>
          </div>
          <Button
            onClick={() => {
              setFormError(null);
              setDisplayName("");
              setEmail("");
              setPassword("");
              setRole("Analysis");
              setCreateOpen(true);
            }}
            className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-5 h-12 rounded-xl shadow-lg shadow-accent/10"
          >
            <Plus className="mr-2 size-4" /> Add System User
          </Button>
        </div>

        {/* Roles Explanation UI */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface/60 backdrop-blur-md border border-border/40 p-6 rounded-3xl space-y-3">
            <div className="flex items-center gap-3 text-primary">
              <Shield className="size-6" />
              <h3 className="font-bold text-lg">Fleet Manager (Admin)</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Full administrative privileges. Can view dashboard analytics, upload and review Certificates of Conformance, manage actions in the Action Center, edit lifecycle rules, and create or delete other system users.
            </p>
          </div>

          <div className="bg-surface/60 backdrop-blur-md border border-border/40 p-6 rounded-3xl space-y-3">
            <div className="flex items-center gap-3 text-emerald-500">
              <Info className="size-6" />
              <h3 className="font-bold text-lg">Analysis</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Read-and-write workflow privileges. Can view dashboard metrics, edit extracted CoC details, manage items in the Action Center, and review lifecycle recommendations. **Restricted from uploading new documents.**
            </p>
          </div>

          <div className="bg-surface/60 backdrop-blur-md border border-border/40 p-6 rounded-3xl space-y-3">
            <div className="flex items-center gap-3 text-amber-500">
              <UserPlus className="size-6" />
              <h3 className="font-bold text-lg">Uploader</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Strictly ingestion privileges. Can access the upload screen to import CoC files. **Restricted from viewing the dashboard, edit recommendation logs, and action center data.**
            </p>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-surface/40 backdrop-blur-md border border-border/40 rounded-3xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-border/40 flex items-center justify-between">
            <h2 className="font-display font-bold text-xl flex items-center gap-2">
              <Users className="size-5 text-primary" /> Active System Credentials
            </h2>
            <span className="text-xs font-mono bg-secondary/80 text-muted-foreground border border-border/40 px-2.5 py-1 rounded-full">
              {users.length} Account{users.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/30 bg-secondary/30">
                  <th className="p-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Name
                  </th>
                  <th className="p-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Email Address
                  </th>
                  <th className="p-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    System Role
                  </th>
                  <th className="p-4 font-semibold text-xs text-muted-foreground uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      No system users registered.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isSelf = u.uid === user?.uid;
                    return (
                      <tr
                        key={u.uid}
                        className="hover:bg-secondary/10 transition-colors group"
                      >
                        <td className="p-4 font-medium text-foreground">
                          {u.displayName}
                        </td>
                        <td className="p-4 text-muted-foreground font-mono text-sm">
                          {u.email}
                        </td>
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                              u.role === "Fleet Manager" || u.role === "System Administrator"
                                ? "bg-primary/10 border-primary/20 text-primary"
                                : u.role === "Analysis"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                                : "bg-amber-500/10 border-amber-500/20 text-amber-500"
                            }`}
                          >
                            <Shield className="size-3" /> {u.role}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSelf}
                            onClick={() => {
                              setUserToDelete(u);
                              setDeleteConfirmOpen(true);
                            }}
                            className={`rounded-xl h-9 px-3 ${
                              isSelf
                                ? "opacity-30 cursor-not-allowed"
                                : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            }`}
                            title={isSelf ? "You cannot delete your own account" : "Delete user credentials"}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">
              Register System Credentials
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Provide corporate details and select an authorization role.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-4 pt-2" autoComplete="off">
            {formError && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="create-name"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Full Name
              </Label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  id="create-name"
                  type="text"
                  placeholder="e.g. John Doe"
                  required
                  className="pl-11 h-12 bg-background border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all text-sm rounded-xl"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="create-email"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Corporate Email
              </Label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  id="create-email"
                  type="email"
                  placeholder="name@womgroup.com"
                  required
                  autoComplete="new-password"
                  className="pl-11 h-12 bg-background border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all text-sm rounded-xl"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="create-password"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Initial Password
              </Label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  id="create-password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  required
                  autoComplete="new-password"
                  className="pl-11 h-12 bg-background border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all text-sm rounded-xl"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="create-role"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Authorization Access Role
              </Label>
              <select
                id="create-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-12 bg-background border border-border/50 focus:border-primary/50 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
              >
                <option value="Analysis">Analysis (Read & Edit, No Upload)</option>
                <option value="Uploader">Uploader (Upload Only, No Dashboard)</option>
                <option value="Fleet Manager">Fleet Manager (Full Admin Access)</option>
              </select>
            </div>

            <div className="pt-2 flex justify-end gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-6"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Registering…
                  </>
                ) : (
                  "Create Credentials"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" /> Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Are you sure you want to delete the user credentials for{" "}
              <strong className="text-foreground">{userToDelete?.displayName}</strong> ({userToDelete?.email})?
              This will immediately revoke their access to the system.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={handleDeleteUser}
              className="bg-destructive hover:bg-destructive/95 text-destructive-foreground font-bold"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Deleting…
                </>
              ) : (
                "Confirm Delete"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
