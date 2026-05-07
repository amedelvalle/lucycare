import { supabase } from '@/lib/supabase';

export async function logAuditEntry({
  action,
  tableName,
  recordId,
  oldData,
  newData,
}: {
  action: 'select' | 'insert' | 'update' | 'delete';
  tableName: string;
  recordId: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from('audit_log').insert({
    user_id: user.id,
    action,
    table_name: tableName,
    record_id: recordId,
    old_data: oldData ?? null,
    new_data: newData ?? null,
    ip_address: null,
  });

  if (error) {
    console.warn('[audit_log] Error al escribir entrada:', error.message);
    // No lanzar — el audit log no bloquea la acción principal
  }
}
