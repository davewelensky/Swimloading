-- Allow admin to read and update all spot suggestions
-- Admin user ID: df137255-3add-4153-b368-32e06e2be188
-- Run in Supabase SQL Editor

CREATE POLICY "Admin can view all suggestions" ON spot_suggestions
  FOR SELECT TO authenticated
  USING (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188');

CREATE POLICY "Admin can update suggestions" ON spot_suggestions
  FOR UPDATE TO authenticated
  USING (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188')
  WITH CHECK (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188');
