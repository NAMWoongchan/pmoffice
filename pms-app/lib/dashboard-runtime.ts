import {replaceVbaProcedure} from './vba-project';
const marker="' PMOFFICE_MILESTONE_LAYOUT_V2";
const text=(s:string)=>s.split('').map(c=>c.charCodeAt(0)>127?`ChrW(${c.charCodeAt(0)})`:`"${c==='"'?'""':c}"`).join(' & ');
const all=text('전체 참여기관'),none=text('해당 연도 마일스톤 없음');
const procedures:[string,'Sub'|'Function',string][]=[
 ['Private Function LastTaskRow(','Function',`Private Function LastTaskRow(ByVal ws As Worksheet) As Long
    LastTaskRow = ws.Cells(ws.Rows.Count, 8).End(xlUp).Row
    If LastTaskRow < 2 Then Err.Raise vbObjectError + 2600, , "No task IDs."
End Function`],
 ['Private Function HasOrg(','Function',`Private Function HasOrg(ByVal raw As String, ByVal org As String) As Boolean
    Dim token As Variant
    If Len(org) = 0 Then HasOrg = True: Exit Function
    raw = Replace(Replace(Replace(Replace(raw, ";", ","), vbCrLf, ","), vbLf, ","), vbCr, ",")
    For Each token In Split(raw, ",")
        If StrComp(Trim$(CStr(token)), org, vbBinaryCompare) = 0 Then HasOrg = True: Exit Function
    Next token
End Function`],
 ['Private Sub BuildTaskIndex()','Sub',`Private Sub BuildTaskIndex()
    Dim ws As Worksheet, db As Worksheet, r As Long, last As Long, oldLast As Long, rowOut As Long
    Dim ids As Object, parents As Object, orgs As Object, token As Variant, org As Variant, p As Long
    Dim wbs As String, key As String, raw As String, d As Variant, e As Variant, flag As String, coreRow As Variant
    Dim summary As Boolean, coreSummary As String, warnings As Long
    Set ws = ThisWorkbook.Worksheets(MAIN): Set db = ThisWorkbook.Worksheets(CORE)
    last = LastTaskRow(ws)
    Set ids = CreateObject("Scripting.Dictionary"): Set parents = CreateObject("Scripting.Dictionary")
    For r = 2 To last
        key = Trim$(CStr(ws.Cells(r, 8).Value2)): wbs = Trim$(CStr(ws.Cells(r, 14).Value2))
        If Len(key) > 0 And Len(wbs) > 0 And Len(CStr(ws.Cells(r, 1).Value2)) > 0 Then
            If ids.Exists(key) Then Err.Raise vbObjectError + 2608, , "Duplicate task ID: " & key
            ids.Add key, r
            p = InStrRev(wbs, ".")
            Do While p > 0
                wbs = Left$(wbs, p - 1): parents(wbs) = True: p = InStrRev(wbs, ".")
            Loop
        End If
    Next r
    oldLast = Application.Max(2, db.Cells(db.Rows.Count, 58).End(xlUp).Row)
    db.Range("AZ1:BF" & oldLast).ClearContents
    db.Range("AZ1:BF1").Value = Array("MSP_Org", "MSP_Start", "MSP_Finish", "MSP_Name", "MSP_Milestone", "MSP_Notes", "MSP_TaskID")
    rowOut = 2
    For r = 2 To last
        key = Trim$(CStr(ws.Cells(r, 8).Value2)): wbs = Trim$(CStr(ws.Cells(r, 14).Value2))
        If Len(key) > 0 And Len(wbs) > 0 And Len(CStr(ws.Cells(r, 1).Value2)) > 0 Then
            summary = (wbs = "0" Or parents.Exists(wbs))
            coreRow = Application.Match(ws.Cells(r, 8).Value2, db.Columns(8), 0)
            If Not IsError(coreRow) Then
                coreSummary = LCase$(Trim$(CStr(db.Cells(CLng(coreRow), 25).Value2)))
                If coreSummary = "true" Or coreSummary = "yes" Or coreSummary = "1" Or coreSummary = "y" Or coreSummary = ${text('예')} Then summary = True
            End If
            If Not summary Then
                d = IndexDate(ws.Cells(r, 4).Value2): e = IndexDate(ws.Cells(r, 5).Value2)
                If Len(CStr(d)) = 0 Or Len(CStr(e)) = 0 Then
                    warnings = warnings + 1: d = ""
                ElseIf CDbl(d) > CDbl(e) Then
                    warnings = warnings + 1: d = ""
                End If
                flag = LCase$(Trim$(CStr(ws.Cells(r, 15).Value2)))
                Set orgs = CreateObject("Scripting.Dictionary"): orgs.Add "", True
                raw = Replace(Replace(Replace(Replace(CStr(ws.Cells(r, 6).Value2), ";", ","), vbCrLf, ","), vbLf, ","), vbCr, ",")
                For Each token In Split(raw, ",")
                    org = Trim$(CStr(token))
                    If Len(org) > 0 Then orgs(CStr(org)) = True
                Next token
                For Each org In orgs.Keys
                    db.Cells(rowOut, 52).Value2 = CStr(org): db.Cells(rowOut, 53).Value2 = d
                    db.Cells(rowOut, 54).Value2 = e: db.Cells(rowOut, 55).Value2 = ws.Cells(r, 1).Value2
                    db.Cells(rowOut, 56).Value2 = Abs(CLng(flag = "yes" Or flag = "true" Or flag = "1" Or flag = "y" Or flag = ${text('예')}))
                    db.Cells(rowOut, 57).Value2 = ws.Cells(r, 11).Value2: db.Cells(rowOut, 58).Value2 = ws.Cells(r, 8).Value2
                    rowOut = rowOut + 1
                Next org
            End If
        End If
    Next r
    If rowOut = 2 Then rowOut = 3
    SetName "MSP_TaskIndex", "='" & CORE & "'!$AZ$2:$BF$" & rowOut - 1
    db.Columns("AZ:BF").Hidden = True: db.Visible = xlSheetVeryHidden
    ThisWorkbook.Worksheets(DASH).Range("B30").Value2 = ${text('날짜 확인 필요 작업: ')} & warnings & ${text('건 · 연도별 집계에서 유효한 날짜만 사용합니다.')}
End Sub

Private Function IndexDate(ByVal value As Variant) As Variant
    Dim n As Double, s As String, dt As Date, base As Double
    IndexDate = "": On Error GoTo InvalidDate
    If IsError(value) Or IsEmpty(value) Or Len(CStr(value)) = 0 Or VarType(value) = vbBoolean Then Exit Function
    If IsNumeric(value) Then
        n = CDbl(value)
    Else
        s = CStr(value)
        If Not s Like "####-##-##" Then Exit Function
        dt = DateSerial(CInt(Left$(s, 4)), CInt(Mid$(s, 6, 2)), CInt(Right$(s, 2)))
        If Format$(dt, "yyyy-mm-dd") <> s Then Exit Function
        n = CDbl(dt): If ThisWorkbook.Date1904 Then n = n - 1462
    End If
    base = IIf(ThisWorkbook.Date1904, 0, 1)
    If n < base Or n >= 2958466 - IIf(ThisWorkbook.Date1904, 1462, 0) Then Exit Function
    If Not ThisWorkbook.Date1904 And Fix(n) = 60 Then Exit Function
    IndexDate = Fix(n)
InvalidDate:
End Function`],
 ['Private Sub WriteMilestoneFormulas()','Sub',`Private Sub WriteMilestoneFormulas()
    Dim ws As Worksheet, db As Range, matrix As Range, r As Long, c As Long, last As Long, yr As String
    Dim orgs As String, starts As String, finishes As String, flags As String, criteria As String
    Set ws = ThisWorkbook.Worksheets(DASH): Set matrix = ThisWorkbook.Names("MSP_MilestoneMatrix").RefersToRange
    Set db = ThisWorkbook.Names("MSP_TaskIndex").RefersToRange: last = db.Row + db.Rows.Count - 1
    orgs = "'" & CORE & "'!$AZ$2:$AZ$" & last: starts = "'" & CORE & "'!$BA$2:$BA$" & last
    finishes = "'" & CORE & "'!$BB$2:$BB$" & last: flags = "'" & CORE & "'!$BD$2:$BD$" & last
    For r = matrix.Row To matrix.Row + matrix.Rows.Count - 1 Step 3
        For c = matrix.Column To matrix.Column + matrix.Columns.Count - 1 Step 2
            yr = ws.Cells(5, c).Address(True, False)
            If Not IsNumeric(ws.Cells(5, c).Value2) Then Err.Raise vbObjectError + 2606, , "Invalid year header."
            criteria = "$B" & r
            If r = matrix.Row Then criteria = Chr$(34) & Chr$(34)
            ws.Cells(r, c).Formula = "=COUNTIFS(" & orgs & "," & criteria & "," & flags & ",1," & finishes & ","">=""&DATE(" & yr & ",1,1)," & finishes & ",""<""&DATE(" & yr & "+1,1,1))"
            ws.Cells(r + 2, c).Formula = "=COUNTIFS(" & orgs & "," & criteria & "," & starts & ","">=""&0," & starts & ",""<>""," & starts & ",""<""&DATE(" & yr & "+1,1,1)," & finishes & ","">=""&DATE(" & yr & ",1,1))"
        Next c
    Next r
End Sub`],
 ['Public Sub DashboardSelection(','Sub',`Public Sub DashboardSelection(ByVal Sh As Object, ByVal Target As Range)
    Dim first As Range, hit As Range, matrix As Range, r As Long, c As Long, ev As Boolean
    Dim num As Long, msg As String
    If mBusy Or Sh.Name <> DASH Then Exit Sub
    If Target.Areas.Count <> 1 Then Exit Sub
    Set first = Target.Cells(1, 1)
    If Target.CountLarge > 1 Then
        If Not first.MergeCells Then Exit Sub
        If Target.Address <> first.MergeArea.Address Then Exit Sub
    End If
    Set matrix = ThisWorkbook.Names("MSP_MilestoneMatrix").RefersToRange
    Set hit = Application.Intersect(first, matrix): If hit Is Nothing Then Exit Sub
    r = matrix.Row + ((first.Row - matrix.Row) \\ 3) * 3
    c = matrix.Column + ((first.Column - matrix.Column) \\ 2) * 2
    On Error GoTo Failed
    ev = Application.EnableEvents: mBusy = True: Application.EnableEvents = False
    SetName "MSP_SelectedCell", "='" & DASH & "'!" & Sh.Cells(r, c).Address
    DisplayMilestones Sh.Cells(r, c)
Clean:
    Application.EnableEvents = ev: mBusy = False
    If num <> 0 Then Err.Raise num, "DashboardSelection", msg
    Exit Sub
Failed:
    num = Err.Number: msg = Err.Description: Resume Clean
End Sub`],
 ['Private Sub DisplayMilestones(','Sub',`Private Sub DisplayMilestones(ByVal anchor As Range)
    Dim ws As Worksheet, db As Range, item As Range, yr As Long, org As String, label As String
    Dim low As Double, high As Double, outRow As Long, last As Long, count As Long, i As Long, j As Long
    Dim rows() As Variant, temp As Variant, names() As Variant, notes() As Variant, n As Variant, memo As Variant
    Set ws = ThisWorkbook.Worksheets(DASH): Set db = ThisWorkbook.Names("MSP_TaskIndex").RefersToRange
    label = CStr(ws.Cells(anchor.Row, 2).Value2): org = label
    If anchor.Row = 7 Then org = ""
    yr = CLng(ws.Cells(5, anchor.Column).Value2)
    low = CDbl(DateSerial(yr, 1, 1)) - IIf(ThisWorkbook.Date1904, 1462, 0)
    high = CDbl(DateSerial(yr + 1, 1, 1)) - IIf(ThisWorkbook.Date1904, 1462, 0)
    ReDim rows(1 To db.Rows.Count): ReDim names(1 To db.Rows.Count): ReDim notes(1 To db.Rows.Count)
    For Each item In db.Rows
        If CStr(item.Cells(1, 1).Value2) = org And item.Cells(1, 5).Value2 = 1 Then
            If IsNumeric(item.Cells(1, 3).Value2) And Len(CStr(item.Cells(1, 3).Value2)) > 0 Then
                If CDbl(item.Cells(1, 3).Value2) >= low And CDbl(item.Cells(1, 3).Value2) < high Then
                    count = count + 1: rows(count) = item.Cells(1, 3).Value2
                    names(count) = item.Cells(1, 4).Value2: notes(count) = item.Cells(1, 6).Value2
                End If
            End If
        End If
    Next item
    For i = 2 To count
        temp = rows(i): n = names(i): memo = notes(i): j = i - 1
        Do While j >= 1
            If CDbl(rows(j)) <= CDbl(temp) Then Exit Do
            rows(j + 1) = rows(j): names(j + 1) = names(j): notes(j + 1) = notes(j): j = j - 1
        Loop
        rows(j + 1) = temp: names(j + 1) = n: notes(j + 1) = memo
    Next i
    last = Application.Max(36, ws.Cells(ws.Rows.Count, 2).End(xlUp).Row, ws.Cells(ws.Rows.Count, 9).End(xlUp).Row, ws.Cells(ws.Rows.Count, 11).End(xlUp).Row)
    ws.Range("B36:M" & last).UnMerge: ws.Range("B36:M" & last).ClearContents
    For i = 1 To Application.Max(1, count)
        outRow = 35 + i
        ws.Range("B" & outRow & ":H" & outRow).Merge
        ws.Range("I" & outRow & ":J" & outRow).Merge
        ws.Range("K" & outRow & ":M" & outRow).Merge
        ws.Range("B36:M36").Copy
        ws.Range("B" & outRow & ":M" & outRow).PasteSpecial xlPasteFormats
        ws.Rows(outRow).RowHeight = 42
        If i <= count Then
            ws.Cells(outRow, 2).Value2 = names(i): ws.Cells(outRow, 9).Value2 = rows(i): ws.Cells(outRow, 11).Value2 = notes(i)
        Else
            ws.Cells(outRow, 2).Value2 = ${none}
        End If
    Next i
    Application.CutCopyMode = False
    ws.Range("B32").Value2 = label & " | " & yr & ${text('년 | 마일스톤 ')} & count & ${text('건')}
    ws.Range("I36:J" & Application.Max(36, 35 + count)).NumberFormat = "yyyy-mm-dd"
    ws.Range("B36:M" & Application.Max(36, 35 + count)).WrapText = True
    ws.PageSetup.PrintArea = "$A$1:$M$" & Application.Max(36, 35 + count)
    SetName "MSP_MilestonePanel", "='" & DASH & "'!$B$36:$M$" & Application.Max(36, 35 + count)
End Sub`]
];
export function upgradeRuntimeSource(original:Uint8Array){
 const view=new TextDecoder('euc-kr').decode(original);if(view.includes(marker))return original;
 if(!view.includes('Option Explicit')||!view.includes('Private Sub RefreshAgencyLinks()'))throw Error('지원되지 않는 마일스톤 VBA 버전입니다. 원본은 유지됩니다.');
 let source=original;for(const [signature,kind,replacement]of procedures)source=replaceVbaProcedure(source,signature,kind,replacement);
 const bytes=new TextEncoder().encode('\r\n'+marker+'\r\n');const out=new Uint8Array(source.length+bytes.length);out.set(source);out.set(bytes,source.length);return out;
}
