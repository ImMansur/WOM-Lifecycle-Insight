export type PartEntry = {
  number: string;
  description: string | null;
  qty: number | null;
};

export type Recommendation = {
  id: string;
  sourceFile: string;
  sourceType: "PDF" | "DOC" | "DOCX";
  extractionStatus: "OK" | "Needs OCR / manual review";
  convertedDocx: string | null;
  customer: string | null;
  salesOrder: string | null;
  purchaseOrder: string | null;
  jobOrProject: string | null;
  location: string | null;
  equipment: string | null;
  partNumbers: PartEntry[];
  serials: string[];
  certificateDate: string | null;
  testedDate: string | null;
  lifecycleDate: string | null;
  recertificationDue: string | null;
  ageMonths: number | null;
  monthsToRecert: number | null;
  status: string;
  priority: "High" | "Low" | "Manual review";
  invoiceBasis: string | null;
  recommendation: string;
  confidence: "High" | "Low";
  notes: string | null;
  textPreview: string | null;
};

