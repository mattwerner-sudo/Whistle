import { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { apiRequest } from '@/lib/queryClient';
import { createCSVBlob, downloadBlob } from '@/lib/csvExport';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle, XCircle, Upload, FileText, Target, BarChart3, AlertTriangle, Check, Loader2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface Alternative {
  id: string;
  name: string;
  fullName: string;
  score: number;
  division?: string;
  conference?: string;
}

interface BatchMatchResult {
  rawName: string;
  matched: boolean;
  schoolId: string | null;
  schoolName: string | null;
  fullName: string | null;
  score: number | null;
  division: string | null;
  conference: string | null;
  isAmbiguous: boolean;
  alternatives: Alternative[];
  userSelectedSchoolId?: string | null;
  aliasSaved?: boolean;
}

interface BatchResponse {
  results: BatchMatchResult[];
  summary: {
    total: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
    matchRate: number;
  };
}

const BATCH_SIZE = 50;
const VALID_COLUMNS = ['school', 'university', 'account', 'name', 'school name', 'university name', 'institution'];

function detectSchoolColumn(headers: string[]): string | null {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const validCol of VALID_COLUMNS) {
    const idx = lowerHeaders.indexOf(validCol);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

interface EnrichedContact {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  schoolName: string;
  schoolId: string;
  conference: string | null;
  division: string | null;
}

export default function ListMatcher() {
  const [results, setResults] = useState<BatchMatchResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; matched: number; ambiguous: number; unmatched: number; matchRate: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedNames, setParsedNames] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // Enrichment Module State
  const [viewState, setViewState] = useState<'matching' | 'contacts'>('matching');
  const [enrichedContacts, setEnrichedContacts] = useState<EnrichedContact[]>([]);

  const parseCSV = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || [];
        const column = detectSchoolColumn(headers);
        
        if (!column) {
          toast({ 
            title: 'Column Not Found', 
            description: `Could not find a column named: ${VALID_COLUMNS.join(', ')}. Please rename your column.`,
            variant: 'destructive' 
          });
          setFileName(null);
          return;
        }
        
        const names = (result.data as Record<string, string>[])
          .map(row => row[column]?.trim())
          .filter(Boolean);
        
        if (names.length === 0) {
          toast({ title: 'No Data', description: 'CSV has no school names in the detected column', variant: 'destructive' });
          setFileName(null);
          return;
        }
        
        setParsedNames(names);
        toast({ 
          title: 'CSV Loaded', 
          description: `Found ${names.length} school names in column "${column}"` 
        });
      },
      error: (err) => {
        toast({ title: 'Parse Error', description: err.message, variant: 'destructive' });
        setFileName(null);
      }
    });
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      parseCSV(file);
    } else {
      toast({ title: 'Invalid File', description: 'Please upload a CSV file', variant: 'destructive' });
    }
  }, [parseCSV, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseCSV(file);
    }
  }, [parseCSV]);

  const handleMatch = async () => {
    if (parsedNames.length === 0) return;
    
    setIsLoading(true);
    setResults([]);
    setSummary(null);
    
    const totalBatches = Math.ceil(parsedNames.length / BATCH_SIZE);
    let allResults: BatchMatchResult[] = [];
    
    setProgress({ current: 0, total: parsedNames.length });
    
    try {
      for (let i = 0; i < totalBatches; i++) {
        const batch = parsedNames.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const res = await apiRequest<BatchResponse>('POST', '/api/accounts/match-batch', { schoolNames: batch });
        allResults = [...allResults, ...res.results];
        setProgress({ current: Math.min((i + 1) * BATCH_SIZE, parsedNames.length), total: parsedNames.length });
        setResults([...allResults]);
      }
      
      const matchedCount = allResults.filter(r => r.matched).length;
      const ambiguousCount = allResults.filter(r => r.isAmbiguous).length;
      const unmatchedCount = allResults.length - matchedCount;
      
      setSummary({
        total: allResults.length,
        matched: matchedCount,
        ambiguous: ambiguousCount,
        unmatched: unmatchedCount,
        matchRate: allResults.length > 0 ? Math.round((matchedCount / allResults.length) * 100) : 0
      });
      
      toast({ 
        title: 'Matching Complete', 
        description: `Found ${matchedCount} of ${allResults.length} accounts (${ambiguousCount} need review)` 
      });
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Error', description: e.message || 'Failed to match schools', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setParsedNames([]);
    setResults([]);
    setSummary(null);
    setFileName(null);
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAmbiguousSelect = (index: number, schoolId: string) => {
    setResults(prev => {
      const updated = [...prev];
      const selectedAlt = updated[index].alternatives.find(a => a.id === schoolId);
      if (selectedAlt) {
        updated[index] = {
          ...updated[index],
          matched: true,
          userSelectedSchoolId: schoolId,
          schoolId: schoolId,
          schoolName: selectedAlt.name,
          fullName: selectedAlt.fullName,
          division: selectedAlt.division || null,
          conference: selectedAlt.conference || null,
          isAmbiguous: false
        };
      } else if (schoolId === updated[index].schoolId) {
        updated[index] = { ...updated[index], matched: true, userSelectedSchoolId: schoolId, isAmbiguous: false };
      }
      return updated;
    });
  };

  const handleSaveAlias = async (index: number) => {
    const result = results[index];
    const schoolId = result.userSelectedSchoolId || result.schoolId;
    if (!schoolId || !result.rawName) return;
    
    try {
      await apiRequest('POST', '/api/accounts/alias', { alias: result.rawName, schoolId });
      setResults(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], aliasSaved: true };
        return updated;
      });
      toast({ title: 'Alias Saved', description: `"${result.rawName}" will now always match "${result.schoolName}"` });
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        toast({ title: 'Already Saved', description: 'This alias already exists', variant: 'default' });
      } else {
        toast({ title: 'Error', description: e.message || 'Failed to save alias', variant: 'destructive' });
      }
    }
  };

  const handleExportMatched = () => {
    const matched = results.filter(r => r.matched);
    const csv = [
      ['Input Name', 'School ID', 'School Name', 'Full Name', 'Division', 'Conference'].join(','),
      ...matched.map(r => [
        `"${r.rawName}"`,
        r.schoolId,
        `"${r.schoolName}"`,
        `"${r.fullName}"`,
        r.division || '',
        r.conference || ''
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'matched-accounts.csv';
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: 'Exported', description: `Downloaded ${matched.length} matched accounts` });
    
    apiRequest('POST', '/api/reports/log-export', {
      format: 'matched-accounts-csv',
      count: matched.length,
    }).catch(() => {});
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const downloadTemplate = () => {
    const templateCSV = [
      'School',
      'Alabama',
      'Ohio State',
      'Notre Dame',
      'Michigan',
      'Texas'
    ].join('\n');
    
    const blob = new Blob([templateCSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'account-list-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: 'Template Downloaded', description: 'Use this format for your account list' });
  };

  const handleEnrich = async () => {
    // Filter out only the successfully matched school IDs
    const matchedIds = results
      .filter(r => r.matched && r.schoolId)
      .map(r => r.userSelectedSchoolId || r.schoolId) as string[];

    if (matchedIds.length === 0) {
      toast({ title: "No Matches", description: "No valid schools to enrich.", variant: "destructive" });
      return;
    }

    // Dedupe school IDs
    const uniqueIds = Array.from(new Set(matchedIds));

    setIsLoading(true);
    try {
      const res = await apiRequest<{ members: EnrichedContact[]; count: number }>('POST', '/api/staff/bulk-fetch', { schoolIds: uniqueIds });
      setEnrichedContacts(res.members);
      setViewState('contacts');
      toast({ title: "Enrichment Complete", description: `Found ${res.count} contacts from ${uniqueIds.length} schools.` });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Error", description: e.message || "Failed to fetch contacts", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadContactsCSV = () => {
    const headers = ['Name', 'Title', 'Email', 'Phone', 'Department', 'School', 'Conference', 'Division'];
    const rows = enrichedContacts.map(c => [
      c.name,
      c.title,
      c.email,
      c.phone,
      c.department,
      c.schoolName,
      c.conference,
      c.division
    ]);
    const blob = createCSVBlob(headers, rows);
    downloadBlob(blob, 'enriched-contacts.csv');
    
    toast({ title: 'Exported', description: `Downloaded ${enrichedContacts.length} contacts` });
  };

  // Enriched Contacts View
  if (viewState === 'contacts') {
    return (
      <div className="p-6 h-screen flex flex-col max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-enriched-title">Enriched Contacts</h1>
            <p className="text-muted-foreground">Found {enrichedContacts.length} contacts from your target accounts.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setViewState('matching')} data-testid="button-back-accounts">
              Back to Accounts
            </Button>
            <Button onClick={downloadContactsCSV} data-testid="button-export-contacts">
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>

        <Card className="flex-1 overflow-hidden">
          <div className="overflow-auto h-full">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Account (School)</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedContacts.map((c) => (
                  <TableRow key={c.id} data-testid={`row-contact-${c.id}`}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.title || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{c.schoolName}</span>
                        {c.conference && (
                          <span className="text-xs text-muted-foreground">{c.conference}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{c.phone || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Target className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Account List Matcher</h1>
          <p className="text-muted-foreground">Upload a CSV to match target accounts against our college database</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Target Accounts
              </CardTitle>
              <CardDescription className="mt-1">
                Drag and drop a CSV file or click to browse. Auto-detects columns: School, University, Account, Name
              </CardDescription>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={downloadTemplate}
              data-testid="button-download-template"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            data-testid="dropzone-csv"
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file"
            />
            {fileName ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-6 w-6 text-primary" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="secondary">{parsedNames.length} rows</Badge>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <Upload className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>Drag and drop your CSV file here, or click to browse</p>
                <p className="text-xs mt-1">Supports columns: School, University, Account, Name</p>
              </div>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button 
              data-testid="button-match" 
              onClick={handleMatch} 
              disabled={isLoading || parsedNames.length === 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Matching...
                </>
              ) : 'Match Accounts'}
            </Button>
            <Button 
              data-testid="button-clear"
              variant="outline" 
              onClick={handleClear}
              disabled={parsedNames.length === 0 && results.length === 0}
            >
              Clear
            </Button>
          </div>
          
          {isLoading && (
            <div className="space-y-2" data-testid="progress-section">
              <Progress value={progressPercent} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                Processing {progress.current} of {progress.total} accounts ({progressPercent}%)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold" data-testid="text-total-count">{summary.total}</p>
                  <p className="text-sm text-muted-foreground">Total Accounts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-matched-count">{summary.matched}</p>
                  <p className="text-sm text-muted-foreground">Matched</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold text-yellow-500" data-testid="text-ambiguous-count">{summary.ambiguous}</p>
                  <p className="text-sm text-muted-foreground">Needs Review</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-2xl font-bold text-primary" data-testid="text-match-rate">{summary.matchRate}%</p>
                  <p className="text-sm text-muted-foreground">Match Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Match Results</CardTitle>
            <div className="flex gap-2">
              <Button 
                data-testid="button-export-matched"
                variant="outline" 
                size="sm" 
                onClick={handleExportMatched}
                disabled={!results.some(r => r.matched)}
              >
                Export Matched
              </Button>
              <Button 
                data-testid="button-get-contacts"
                size="sm" 
                onClick={handleEnrich}
                disabled={isLoading || !results.some(r => r.matched)}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : 'Get Contacts'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Input Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Matched School</TableHead>
                  <TableHead>Division</TableHead>
                  <TableHead>Conference</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i} data-testid={`row-result-${i}`}>
                    <TableCell className="font-medium">{r.rawName}</TableCell>
                    <TableCell>
                      {r.isAmbiguous ? (
                        <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Review
                        </Badge>
                      ) : r.matched ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                          <CheckCircle className="h-3 w-3 mr-1" /> Found
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" /> Missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.isAmbiguous ? (
                        <Select 
                          onValueChange={(val) => handleAmbiguousSelect(i, val)}
                          data-testid={`select-school-${i}`}
                        >
                          <SelectTrigger className="w-64" data-testid={`select-trigger-${i}`}>
                            <SelectValue placeholder="Select correct school..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={r.schoolId || ''} data-testid={`select-option-primary-${i}`}>
                              {r.schoolName} ({r.fullName})
                            </SelectItem>
                            {r.alternatives.map((alt, j) => (
                              <SelectItem key={alt.id} value={alt.id} data-testid={`select-option-alt-${i}-${j}`}>
                                {alt.name} ({alt.fullName})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : r.schoolName ? (
                        <div>
                          <div className="font-medium">{r.schoolName}</div>
                          <div className="text-xs text-muted-foreground">{r.fullName}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.division ? (
                        <Badge variant="outline">{r.division}</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {r.conference ? (
                        <Badge variant="secondary">{r.conference}</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.matched && (
                          <Button 
                            data-testid={`button-view-staff-${i}`}
                            variant="ghost" 
                            size="sm" 
                            onClick={() => window.open(`/?school=${r.schoolId}`, '_blank')}
                          >
                            View Staff
                          </Button>
                        )}
                        {r.matched && r.userSelectedSchoolId && !r.aliasSaved && (
                          <Button
                            data-testid={`button-save-alias-${i}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSaveAlias(i)}
                          >
                            <Check className="h-3 w-3 mr-1" /> Correct
                          </Button>
                        )}
                        {r.aliasSaved && (
                          <Badge variant="secondary" className="ml-1">
                            <Check className="h-3 w-3 mr-1" /> Saved
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
