export interface PatientStudy {
  patient_id: string;
  study_id: string;
  frequency_seconds: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED';
  last_refresh_at: string | null;
  data_sources: string | null; // JSON array of strings, e.g., '["epic","cerner"]'
  created_at: string;
}