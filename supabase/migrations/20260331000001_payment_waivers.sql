-- Add payment waiver columns to enrollments.
-- A waiver is 1:1 with an enrollment, so columns on the same table are simpler
-- than a separate table.
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_waived boolean NOT NULL DEFAULT false;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS waived_by uuid REFERENCES profiles(id);
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS waived_at timestamptz;

-- Allow admins and teachers to insert enrollments (for waiver flow).
-- The existing RLS policies cover student self-enrollment and parent enrollment.
-- This policy allows admin/teacher to insert enrollments for any student in their mosque.
CREATE POLICY "admins_teachers_insert_enrollments" ON enrollments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM programs p
      JOIN mosque_memberships mm
        ON mm.mosque_id = p.mosque_id
        AND mm.profile_id = auth.uid()
      WHERE p.id = enrollments.program_id
        AND mm.role IN ('mosque_admin', 'teacher', 'lead_teacher')
        AND (mm.role = 'mosque_admin' OR mm.can_manage_programs = true)
    )
  );

-- Allow admins to delete waived enrollments (for revoke waiver flow).
-- Existing delete policies may not cover admin deleting another user's enrollment.
CREATE POLICY "admins_delete_enrollments" ON enrollments
  FOR DELETE USING (
    enrollments.payment_waived = true
    AND EXISTS (
      SELECT 1
      FROM programs p
      JOIN mosque_memberships mm
        ON mm.mosque_id = p.mosque_id
        AND mm.profile_id = auth.uid()
      WHERE p.id = enrollments.program_id
        AND mm.role = 'mosque_admin'
    )
  );

-- Allow admins and teachers to update application status (for waiver joining).
-- They need to set status to 'joined' after waiving payment.
CREATE POLICY "admins_teachers_update_applications" ON program_applications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM programs p
      JOIN mosque_memberships mm
        ON mm.mosque_id = p.mosque_id
        AND mm.profile_id = auth.uid()
      WHERE p.id = program_applications.program_id
        AND mm.role IN ('mosque_admin', 'teacher', 'lead_teacher')
        AND (mm.role = 'mosque_admin' OR mm.can_manage_programs = true)
    )
  );
