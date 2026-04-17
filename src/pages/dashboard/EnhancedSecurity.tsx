import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  Lock, 
  Smartphone, 
  Eye, 
  EyeOff,
  AlertTriangle,
  Users,
  Settings,
  RefreshCw,
  UserCheck,
  Globe,
  Database
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface SecuritySetting {
  id: string;
  category: 'authentication' | 'authorization' | 'privacy' | 'audit' | 'compliance';
  setting: string;
  value: string | boolean | number;
  description: string;
  isEditable: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface UserSession {
  id: string;
  userId: string;
  email: string;
  device: string;
  ipAddress: string;
  location: string;
  loginTime: string;
  lastActivity: string;
  isActive: boolean;
  riskScore: number;
}

interface Permission {
  id: string;
  role: string;
  resource: string;
  actions: string[];
  conditions: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  status: 'success' | 'failure';
}

export default function EnhancedSecurity() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('authentication');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [newSessionAlert, setNewSessionAlert] = useState(false);
  const [selectedRole, setSelectedRole] = useState('student');
  const [permissionFilter, setPermissionFilter] = useState('all');

  // Mock data for security settings
  useQuery({
    queryKey: ['security-settings'],
    queryFn: async () => {
      return [
        {
          id: '1',
          category: 'authentication',
          setting: 'two_factor_auth',
          value: twoFactorEnabled,
          description: 'Enable two-factor authentication for all users',
          isEditable: true,
          riskLevel: 'high'
        },
        {
          id: '2',
          category: 'authentication',
          setting: 'session_timeout',
          value: 30,
          description: 'Session timeout in minutes',
          isEditable: true,
          riskLevel: 'medium'
        },
        {
          id: '3',
          category: 'privacy',
          setting: 'data_encryption',
          value: true,
          description: 'Encrypt sensitive data at rest',
          isEditable: false,
          riskLevel: 'critical'
        }
      ] as SecuritySetting[];
    }
  });

  // Mock data for user sessions
  const { data: userSessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['user-sessions'],
    queryFn: async () => {
      return [
        {
          id: '1',
          userId: user?.id || '',
          email: user?.email || '',
          device: 'Chrome on Windows',
          ipAddress: '192.168.1.100',
          location: 'New York, USA',
          loginTime: '2026-03-10T08:00:00Z',
          lastActivity: '2026-03-10T10:30:00Z',
          isActive: true,
          riskScore: 15
        },
        {
          id: '2',
          userId: user?.id || '',
          email: user?.email || '',
          device: 'Safari on iPhone',
          ipAddress: '192.168.1.101',
          location: 'Boston, USA',
          loginTime: '2026-03-09T14:00:00Z',
          lastActivity: '2026-03-09T16:45:00Z',
          isActive: false,
          riskScore: 25
        }
      ] as UserSession[];
    }
  });

  // Mock data for permissions
  const { data: permissions = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      return [
        {
          id: '1',
          role: 'student',
          resource: 'grades',
          actions: ['read'],
          conditions: ['own_records_only'],
          isActive: true,
          createdAt: '2026-03-01T10:00:00Z',
          updatedAt: '2026-03-01T10:00:00Z'
        },
        {
          id: '2',
          role: 'instructor',
          resource: 'grades',
          actions: ['read', 'write', 'delete'],
          conditions: ['own_subjects', 'department'],
          isActive: true,
          createdAt: '2026-03-01T10:00:00Z',
          updatedAt: '2026-03-01T10:00:00Z'
        },
        {
          id: '3',
          role: 'admin',
          resource: 'system_settings',
          actions: ['read', 'write', 'delete'],
          conditions: [],
          isActive: true,
          createdAt: '2026-03-01T10:00:00Z',
          updatedAt: '2026-03-01T10:00:00Z'
        }
      ] as Permission[];
    }
  });

  // Mock data for audit logs
  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      return [
        {
          id: '1',
          userId: user?.id || '',
          action: 'login',
          resource: 'authentication',
          details: 'User logged in successfully',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          timestamp: '2026-03-10T08:00:00Z',
          severity: 'info',
          status: 'success'
        },
        {
          id: '2',
          userId: 'user-123',
          action: 'failed_login',
          resource: 'authentication',
          details: 'Invalid password attempt',
          ipAddress: '192.168.1.200',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          timestamp: '2026-03-10T07:45:00Z',
          severity: 'warning',
          status: 'failure'
        },
        {
          id: '3',
          userId: 'admin-001',
          action: 'permission_change',
          resource: 'system_settings',
          details: 'Modified instructor permissions for CS101',
          ipAddress: '192.168.1.50',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          timestamp: '2026-03-10T06:30:00Z',
          severity: 'warning',
          status: 'success'
        }
      ] as AuditLog[];
    }
  });

  const queryClient = useQueryClient();

  const updateSecuritySetting = useMutation({
    mutationFn: async ({ setting, value }: { setting: string; value: any }) => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-settings'] });
    }
  });

  const revokeSession = useMutation({
    mutationFn: async (sessionId: string) => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });

  const getRiskColor = (score: number) => {
    if (score < 20) return 'text-success';
    if (score < 40) return 'text-warning';
    if (score < 60) return 'text-warning';
    return 'text-destructive';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'info': return 'bg-primary/15 text-primary border border-primary/30';
      case 'warning': return 'bg-warning/20 text-warning-foreground border border-warning/30';
      case 'error': return 'bg-destructive/15 text-destructive border border-destructive/30';
      case 'critical': return 'bg-destructive/20 text-destructive border border-destructive/40';
      default: return 'bg-muted text-muted-foreground border border-border';
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-success/15 text-success border border-success/30';
      case 'medium': return 'bg-warning/20 text-warning-foreground border border-warning/30';
      case 'high': return 'bg-warning/20 text-warning-foreground border border-warning/30';
      case 'critical': return 'bg-destructive/15 text-destructive border border-destructive/30';
      default: return 'bg-muted text-muted-foreground border border-border';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
        <div>
          <h1 className="text-2xl font-display font-bold">Enhanced Security</h1>
          <p className="text-muted-foreground">Advanced security and access control</p>
        </div>
        
        <Badge className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Security Center
        </Badge>
        </div>
      </section>

      {newSessionAlert && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            New login detected from unfamiliar device. Please review your active sessions.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="authentication" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Authentication
          </TabsTrigger>
          <TabsTrigger value="permissions" className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Permissions
          </TabsTrigger>
          <TabsTrigger value="sessions" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Audit Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="authentication" className="mt-6">
          <Card className="bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Authentication Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-4">Two-Factor Authentication</h3>
                  
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <Label htmlFor="2fa-toggle">Enable 2FA</Label>
                      <p className="text-sm text-muted-foreground">
                        Add an extra layer of security to your account
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="2fa-toggle"
                        checked={twoFactorEnabled}
                        onCheckedChange={(checked) => {
                          setTwoFactorEnabled(checked === true);
                          updateSecuritySetting.mutate({ 
                            setting: 'two_factor_auth', 
                            value: checked === true 
                          });
                        }}
                      />
                      <span className="text-sm font-medium">
                        {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>

                  {twoFactorEnabled && (
                    <div className="space-y-4">
                      <div className="border rounded p-3">
                        <h4 className="font-medium mb-2">Backup Codes</h4>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="border rounded p-2 text-center font-mono">
                            <span className="text-xs text-muted-foreground">Backup 1</span>
                            <span className="text-lg">123456</span>
                          </div>
                          <div className="border rounded p-2 text-center font-mono">
                            <span className="text-xs text-muted-foreground">Backup 2</span>
                            <span className="text-lg">789012</span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => setShowBackupCodes(!showBackupCodes)}
                          className="w-full"
                        >
                          {showBackupCodes ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                          {showBackupCodes ? 'Hide Codes' : 'Show Codes'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Session Management</h3>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="session-timeout">Session Timeout</Label>
                    <Select
                      value="30"
                      onValueChange={(value) => {
                        updateSecuritySetting.mutate({ 
                          setting: 'session_timeout', 
                          value: parseInt(value) 
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                        <SelectItem value="120">2 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <Card className="bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Role-Based Permissions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <Label htmlFor="role-filter">Filter by Role</Label>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="instructor">Instructor</SelectItem>
                      <SelectItem value="admin">Administrator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex-1">
                  <Label htmlFor="permission-filter">Filter by Resource</Label>
                  <Select value={permissionFilter} onValueChange={setPermissionFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select resource" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Resources</SelectItem>
                      <SelectItem value="grades">Grades</SelectItem>
                      <SelectItem value="attendance">Attendance</SelectItem>
                      <SelectItem value="reports">Reports</SelectItem>
                      <SelectItem value="system_settings">System Settings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Current Permissions</h3>
                <div className="grid gap-4">
                  {permissions
                    .filter(p => 
                      (selectedRole === 'all' || p.role === selectedRole) &&
                      (permissionFilter === 'all' || p.resource === permissionFilter)
                    )
                    .map((permission) => (
                      <div key={permission.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-medium">{permission.role}</h4>
                            <p className="text-sm text-muted-foreground">{permission.resource}</p>
                          </div>
                          <Badge variant={permission.isActive ? 'default' : 'secondary'}>
                            {permission.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        
                        <div className="space-y-2">
                          <div>
                            <span className="text-sm font-medium">Actions:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {permission.actions.map((action, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {action}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          
                          <div>
                            <span className="text-sm font-medium">Conditions:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {permission.conditions.map((condition, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {condition.replace(/_/g, ' ')}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-6">
          <Card className="bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Active Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Current Active Sessions</h3>
                <div className="grid gap-4">
                  {userSessions.map((session) => (
                    <div key={session.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{session.email}</h4>
                            <Badge variant={session.isActive ? 'default' : 'secondary'}>
                              {session.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Smartphone className="h-4 w-4" />
                              <span>{session.device}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Globe className="h-4 w-4" />
                              <span>{session.location}</span>
                            </div>
                          </div>
                          
                          <div className="text-sm">
                            <div>Login: {new Date(session.loginTime).toLocaleString()}</div>
                            <div>Last Activity: {new Date(session.lastActivity).toLocaleString()}</div>
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Risk Score:</span>
                            <span className={`font-bold ${getRiskColor(session.riskScore)}`}>
                              {session.riskScore}
                            </span>
                          </div>
                          
                          {!session.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => revokeSession.mutate(session.id)}
                              className="flex items-center gap-2"
                            >
                              <RefreshCw className="h-4 w-4" />
                              Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <Card className="bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Audit Logs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Recent Security Events</h3>
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{log.action}</h4>
                            <Badge className={getSeverityColor(log.severity)}>
                              {log.severity}
                            </Badge>
                            <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                              {log.status}
                            </Badge>
                          </div>
                          
                          <p className="text-sm text-muted-foreground mb-2">
                            {log.details}
                          </p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
                            <div>User ID: {log.userId}</div>
                            <div>Resource: {log.resource}</div>
                            <div>IP: {log.ipAddress}</div>
                            <div>Time: {new Date(log.timestamp).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
