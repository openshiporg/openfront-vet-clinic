-- Review r4 F4: dental findings and procedures are lists of short strings (at most 50 entries, 500 characters each).
CREATE OR REPLACE FUNCTION vc_dental_list_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NULL OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) <= 50 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v) i WHERE jsonb_typeof(i) <> 'string' OR length(i #>> '{}') > 500))
$$;
CREATE OR REPLACE FUNCTION vc_dental_teeth_valid(teeth jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT teeth IS NULL OR (jsonb_typeof(teeth) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(teeth) e
     WHERE e.key !~ '^[1-8](0[1-9]|1[0-1])$'
        OR jsonb_typeof(e.value) <> 'object'
        OR (e.value ? 'findings' AND NOT vc_dental_list_valid(e.value -> 'findings'))
        OR (e.value ? 'procedures' AND NOT vc_dental_list_valid(e.value -> 'procedures'))))
$$;
