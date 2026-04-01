-- Ensure profiles has INSERT and UPDATE policies for authenticated users.
-- Without these, signups fail with "new row violates row-level security policy".

-- Users can insert their own profile (id must match auth.uid())
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY "profiles_insert_own" ON profiles
      FOR INSERT WITH CHECK (id = auth.uid());
  END IF;
END $$;

-- Users can update their own profile
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY "profiles_update_own" ON profiles
      FOR UPDATE USING (id = auth.uid());
  END IF;
END $$;
