//! Page counter owned by this crate. It does not use another PDF library.
//! Flate streams go through flate2, which is zlib.

use std::collections::{HashMap, HashSet};
use std::io::Read;

use flate2::read::ZlibDecoder;

const NO_READ: &str = "This PDF could not be read.";

#[derive(Clone)]
#[allow(dead_code)]
enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Name(String),
    Ref(u32, u32),
    Array(Vec<Value>),
    Dict(HashMap<String, Value>),
    Stream { dict: HashMap<String, Value>, data: Vec<u8> },
}

#[derive(Clone)]
enum Loc {
    Offset(usize),
    Compressed { stream: u32, index: usize },
}

struct Reader {
    bytes: Vec<u8>,
    pos: usize,
    xref: HashMap<u32, Loc>,
    objects: HashMap<u32, Value>,
    streams: HashMap<u32, Vec<Value>>,
}

pub fn page_count(bytes: &[u8]) -> Result<u32, String> {
    if bytes.is_empty() {
        return Err(NO_READ.to_string());
    }
    Reader::new(bytes.to_vec()).count()
}

#[no_mangle]
pub extern "C" fn pdfcommons_page_count(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 {
        return -1;
    }
    // The caller keeps `ptr` alive for `len` bytes. This reads that buffer and does not free it.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    match page_count(bytes) {
        Ok(count) => count as i32,
        Err(_) => -1,
    }
}

fn inflate(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = ZlibDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).map_err(|_| NO_READ.to_string())?;
    Ok(out)
}

fn paeth(left: u8, up: u8, up_left: u8) -> u8 {
    let estimate = left as i16 + up as i16 - up_left as i16;
    let left_dist = (estimate - left as i16).abs();
    let up_dist = (estimate - up as i16).abs();
    let diag = (estimate - up_left as i16).abs();
    if left_dist <= up_dist && left_dist <= diag {
        left
    } else if up_dist <= diag {
        up
    } else {
        up_left
    }
}

fn unpredict(data: &[u8], columns: usize) -> Result<Vec<u8>, String> {
    if columns < 1 {
        return Err(NO_READ.to_string());
    }
    let mut out = Vec::new();
    let mut prev = vec![0u8; columns];
    let mut at = 0;
    while at < data.len() {
        let tag = data[at];
        at += 1;
        if at + columns > data.len() {
            return Err(NO_READ.to_string());
        }
        let mut row = vec![0u8; columns];
        for column in 0..columns {
            let raw = data[at + column];
            let left = if column > 0 { row[column - 1] } else { 0 };
            let up = prev[column];
            let up_left = if column > 0 { prev[column - 1] } else { 0 };
            row[column] = match tag {
                1 => raw.wrapping_add(left),
                2 => raw.wrapping_add(up),
                3 => raw.wrapping_add(((left as u16 + up as u16) / 2) as u8),
                4 => raw.wrapping_add(paeth(left, up, up_left)),
                _ => raw,
            };
        }
        at += columns;
        out.extend_from_slice(&row);
        prev = row;
    }
    Ok(out)
}

impl Reader {
    fn new(bytes: Vec<u8>) -> Self {
        Self {
            bytes,
            pos: 0,
            xref: HashMap::new(),
            objects: HashMap::new(),
            streams: HashMap::new(),
        }
    }

    fn count(&mut self) -> Result<u32, String> {
        if !self.has_header() {
            return Err(NO_READ.to_string());
        }
        let start = self.find_startxref()?;
        let trailer = self.xref_from(start)?;
        if trailer.contains_key("Encrypt") {
            return Err(NO_READ.to_string());
        }
        let root = self.deref_owned(trailer.get("Root").cloned())?;
        let pages = match root {
            Value::Dict(dict) => self.deref_owned(dict.get("Pages").cloned())?,
            _ => return Err(NO_READ.to_string()),
        };
        self.walk(&pages, &mut HashSet::new())
    }

    fn has_header(&self) -> bool {
        let end = self.bytes.len().min(1024);
        String::from_utf8_lossy(&self.bytes[..end]).contains("%PDF-")
    }

    fn find_startxref(&mut self) -> Result<usize, String> {
        let marker = b"startxref";
        let mut found = None;
        for at in 0..=self.bytes.len().saturating_sub(marker.len()) {
            if self.bytes[at..].starts_with(marker) {
                found = Some(at);
            }
        }
        let at = found.ok_or_else(|| NO_READ.to_string())?;
        self.pos = at + marker.len();
        self.skip();
        let offset = self.number().ok_or_else(|| NO_READ.to_string())?;
        if offset < 0.0 {
            return Err(NO_READ.to_string());
        }
        Ok(offset as usize)
    }

    fn xref_from(&mut self, start: usize) -> Result<HashMap<String, Value>, String> {
        let mut trailer = None;
        let mut offset = start;
        let mut seen = HashSet::new();
        while seen.insert(offset) {
            self.pos = offset;
            self.skip();
            if self.starts("xref") {
                let parsed = self.classic_xref()?;
                let prev = match parsed.get("Prev") {
                    Some(Value::Number(number)) => Some(*number as usize),
                    _ => None,
                };
                if trailer.is_none() {
                    trailer = Some(parsed);
                }
                match prev {
                    Some(next) => offset = next,
                    None => break,
                }
                continue;
            }
            let value = self.object()?;
            let Value::Stream { dict, data } = value else {
                return Err(NO_READ.to_string());
            };
            if name_of(dict.get("Type")) != Some("XRef") {
                return Err(NO_READ.to_string());
            }
            let parsed = self.xref_stream(&dict, &data)?;
            let prev = match parsed.get("Prev") {
                Some(Value::Number(number)) => Some(*number as usize),
                _ => None,
            };
            if trailer.is_none() {
                trailer = Some(parsed);
            }
            match prev {
                Some(next) => offset = next,
                None => break,
            }
        }
        trailer.ok_or_else(|| NO_READ.to_string())
    }

    fn classic_xref(&mut self) -> Result<HashMap<String, Value>, String> {
        self.word("xref")?;
        loop {
            self.skip();
            if self.starts("trailer") {
                break;
            }
            let first = self.number().ok_or_else(|| NO_READ.to_string())? as u32;
            let count = self.number().ok_or_else(|| NO_READ.to_string())? as usize;
            for index in 0..count {
                self.skip();
                let line = self.line();
                let mut parts = line.split_whitespace();
                let offset: usize = parts
                    .next()
                    .ok_or_else(|| NO_READ.to_string())?
                    .parse()
                    .map_err(|_| NO_READ.to_string())?;
                let _gen = parts.next().ok_or_else(|| NO_READ.to_string())?;
                let flag = parts.next().ok_or_else(|| NO_READ.to_string())?;
                let object_number = first + index as u32;
                if self.xref.contains_key(&object_number) {
                    continue;
                }
                if flag == "n" {
                    self.xref.insert(object_number, Loc::Offset(offset));
                }
            }
        }
        self.word("trailer")?;
        match self.value()? {
            Value::Dict(dict) => Ok(dict),
            _ => Err(NO_READ.to_string()),
        }
    }

    fn xref_stream(&mut self, dict: &HashMap<String, Value>, data: &[u8]) -> Result<HashMap<String, Value>, String> {
        let widths = ints(dict.get("W"));
        if widths.len() != 3 {
            return Err(NO_READ.to_string());
        }
        let type_width = widths[0] as usize;
        let field2_width = widths[1] as usize;
        let field3_width = widths[2] as usize;
        let row = type_width + field2_width + field3_width;
        let mut bytes = self.filtered(dict, data)?;
        let parms = match dict.get("DecodeParms").cloned() {
            Some(value) => self.deref_owned(Some(value))?,
            None => Value::Null,
        };
        let (predictor, columns) = match parms {
            Value::Dict(map) => {
                let predictor = match map.get("Predictor") {
                    Some(Value::Number(number)) => *number as i32,
                    _ => 1,
                };
                let columns = match map.get("Columns") {
                    Some(Value::Number(number)) => *number as usize,
                    _ => row,
                };
                (predictor, columns)
            }
            _ => (1, row),
        };
        if predictor >= 10 {
            bytes = unpredict(&bytes, columns)?;
        }
        let mut subsections = ints(dict.get("Index"));
        if subsections.is_empty() {
            let size = match dict.get("Size") {
                Some(Value::Number(number)) => *number as i64,
                _ => 0,
            };
            subsections = vec![0, size];
        }
        let mut at = 0;
        let mut pair = 0;
        while pair + 1 < subsections.len() {
            let first = subsections[pair] as u32;
            let count = subsections[pair + 1] as usize;
            pair += 2;
            for entry in 0..count {
                if at + row > bytes.len() {
                    return Err(NO_READ.to_string());
                }
                let kind = if type_width == 0 { 1 } else { read_int(&bytes, at, type_width) };
                at += type_width;
                let field2 = read_int(&bytes, at, field2_width);
                at += field2_width;
                let field3 = read_int(&bytes, at, field3_width);
                at += field3_width;
                let object_number = first + entry as u32;
                if self.xref.contains_key(&object_number) || kind == 0 {
                    continue;
                }
                if kind == 1 {
                    self.xref.insert(object_number, Loc::Offset(field2 as usize));
                } else if kind == 2 {
                    self.xref.insert(
                        object_number,
                        Loc::Compressed { stream: field2 as u32, index: field3 as usize },
                    );
                } else {
                    return Err(NO_READ.to_string());
                }
            }
        }
        Ok(dict.clone())
    }

    fn filtered(&self, dict: &HashMap<String, Value>, data: &[u8]) -> Result<Vec<u8>, String> {
        let filter = dict.get("Filter");
        let name = name_of(filter).or_else(|| match filter {
            Some(Value::Array(items)) => name_of(items.first()),
            _ => None,
        });
        match name {
            None => Ok(data.to_vec()),
            Some("FlateDecode") => {
                if let Some(Value::Array(items)) = filter {
                    if items.len() > 1 {
                        return Err(NO_READ.to_string());
                    }
                }
                inflate(data)
            }
            Some(_) => Err(NO_READ.to_string()),
        }
    }

    fn deref_owned(&mut self, value: Option<Value>) -> Result<Value, String> {
        let Some(value) = value else {
            return Err(NO_READ.to_string());
        };
        let Value::Ref(number, _) = value else {
            return Ok(value);
        };
        if let Some(cached) = self.objects.get(&number).cloned() {
            return Ok(cached);
        }
        let loc = self.xref.get(&number).cloned().ok_or_else(|| NO_READ.to_string())?;
        let parsed = match loc {
            Loc::Offset(offset) => {
                self.pos = offset;
                let parsed = self.object()?;
                self.objects.insert(number, parsed.clone());
                parsed
            }
            Loc::Compressed { stream, index } => {
                let packed = self.object_stream(stream)?;
                let item = packed.get(index).cloned().ok_or_else(|| NO_READ.to_string())?;
                self.objects.insert(number, item.clone());
                item
            }
        };
        Ok(parsed)
    }

    fn object_stream(&mut self, number: u32) -> Result<Vec<Value>, String> {
        if let Some(cached) = self.streams.get(&number).cloned() {
            return Ok(cached);
        }
        let value = self.deref_owned(Some(Value::Ref(number, 0)))?;
        let Value::Stream { dict, data } = value else {
            return Err(NO_READ.to_string());
        };
        if name_of(dict.get("Type")) != Some("ObjStm") {
            return Err(NO_READ.to_string());
        }
        let count = match dict.get("N") {
            Some(Value::Number(number)) => *number as usize,
            _ => return Err(NO_READ.to_string()),
        };
        let first = match dict.get("First") {
            Some(Value::Number(number)) => *number as usize,
            _ => return Err(NO_READ.to_string()),
        };
        let inflated = self.filtered(&dict, &data)?;
        let header = String::from_utf8_lossy(&inflated[..first.min(inflated.len())]).to_string();
        let pairs: Vec<usize> = header
            .split_whitespace()
            .map(|part| part.parse::<usize>().map_err(|_| NO_READ.to_string()))
            .collect::<Result<_, _>>()?;
        if pairs.len() < count * 2 {
            return Err(NO_READ.to_string());
        }
        let saved = std::mem::replace(&mut self.bytes, inflated);
        let saved_pos = self.pos;
        let mut objects = Vec::new();
        for index in 0..count {
            self.pos = first + pairs[index * 2 + 1];
            objects.push(self.value()?);
        }
        self.bytes = saved;
        self.pos = saved_pos;
        self.streams.insert(number, objects.clone());
        Ok(objects)
    }

    fn walk(&mut self, value: &Value, seen: &mut HashSet<String>) -> Result<u32, String> {
        let page = self.deref_owned(Some(value.clone()))?;
        let Value::Dict(dict) = page else {
            return Err(NO_READ.to_string());
        };
        if name_of(dict.get("Type")) == Some("Page") {
            return Ok(1);
        }
        let Some(Value::Array(kids)) = dict.get("Kids").cloned() else {
            if name_of(dict.get("Type")) == Some("Pages") {
                if let Some(Value::Number(count)) = dict.get("Count") {
                    return Ok(*count as u32);
                }
            }
            return Err(NO_READ.to_string());
        };
        let mut total = 0u32;
        for kid in kids {
            if let Value::Ref(number, gen) = kid {
                let key = format!("{number} {gen}");
                if !seen.insert(key) {
                    return Err(NO_READ.to_string());
                }
            }
            total += self.walk(&kid, seen)?;
        }
        Ok(total)
    }

    fn object(&mut self) -> Result<Value, String> {
        self.skip();
        self.number().ok_or_else(|| NO_READ.to_string())?;
        self.number().ok_or_else(|| NO_READ.to_string())?;
        self.word("obj")?;
        let value = self.value()?;
        self.skip();
        if !self.starts("stream") {
            return Ok(value);
        }
        let Value::Dict(dict) = value else {
            return Err(NO_READ.to_string());
        };
        self.word("stream")?;
        if self.bytes.get(self.pos) == Some(&13) {
            self.pos += 1;
        }
        if self.bytes.get(self.pos) == Some(&10) {
            self.pos += 1;
        }
        let length = self.deref_owned(dict.get("Length").cloned())?;
        let Value::Number(length) = length else {
            return Err(NO_READ.to_string());
        };
        let length = length as usize;
        if self.pos + length > self.bytes.len() {
            return Err(NO_READ.to_string());
        }
        let data = self.bytes[self.pos..self.pos + length].to_vec();
        self.pos += length;
        Ok(Value::Stream { dict, data })
    }

    fn value(&mut self) -> Result<Value, String> {
        self.skip();
        let byte = *self.bytes.get(self.pos).ok_or_else(|| NO_READ.to_string())?;
        if byte == b'<' && self.bytes.get(self.pos + 1) == Some(&b'<') {
            return self.dict();
        }
        if byte == b'[' {
            return self.array();
        }
        if byte == b'(' {
            return Ok(Value::String(self.literal()));
        }
        if byte == b'<' {
            return Ok(Value::String(self.hex()?));
        }
        if byte == b'/' {
            return Ok(Value::Name(self.raw_name()));
        }
        if self.keyword("true") {
            return Ok(Value::Bool(true));
        }
        if self.keyword("false") {
            return Ok(Value::Bool(false));
        }
        if self.keyword("null") {
            return Ok(Value::Null);
        }
        let first = self.number().ok_or_else(|| NO_READ.to_string())?;
        let mark = self.pos;
        self.skip();
        if let Some(second) = self.number() {
            self.skip();
            if self.keyword("R") {
                return Ok(Value::Ref(first as u32, second as u32));
            }
        }
        self.pos = mark;
        Ok(Value::Number(first))
    }

    fn dict(&mut self) -> Result<Value, String> {
        self.pos += 2;
        let mut dict = HashMap::new();
        loop {
            self.skip();
            if self.bytes.get(self.pos) == Some(&b'>') && self.bytes.get(self.pos + 1) == Some(&b'>') {
                self.pos += 2;
                return Ok(Value::Dict(dict));
            }
            if self.bytes.get(self.pos) != Some(&b'/') {
                return Err(NO_READ.to_string());
            }
            let key = self.raw_name();
            dict.insert(key, self.value()?);
        }
    }

    fn array(&mut self) -> Result<Value, String> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip();
            if self.bytes.get(self.pos) == Some(&b']') {
                self.pos += 1;
                return Ok(Value::Array(items));
            }
            items.push(self.value()?);
        }
    }

    fn literal(&mut self) -> String {
        self.pos += 1;
        let mut text = String::new();
        let mut depth = 1;
        while self.pos < self.bytes.len() && depth > 0 {
            let byte = self.bytes[self.pos];
            self.pos += 1;
            if byte == b'\\' {
                let next = self.bytes.get(self.pos).copied().unwrap_or(0);
                self.pos += 1;
                match next {
                    b'n' => text.push('\n'),
                    b'r' => text.push('\r'),
                    b't' => text.push('\t'),
                    b'b' => text.push('\u{8}'),
                    b'f' => text.push('\u{c}'),
                    b'0'..=b'7' => {
                        let mut octal = String::new();
                        octal.push(next as char);
                        for _ in 0..2 {
                            let digit = self.bytes.get(self.pos).copied().unwrap_or(0);
                            if !(b'0'..=b'7').contains(&digit) {
                                break;
                            }
                            octal.push(digit as char);
                            self.pos += 1;
                        }
                        if let Ok(code) = u32::from_str_radix(&octal, 8) {
                            if let Some(ch) = char::from_u32(code) {
                                text.push(ch);
                            }
                        }
                    }
                    10 | 13 => {}
                    _ => text.push(next as char),
                }
                continue;
            }
            if byte == b'(' {
                depth += 1;
            }
            if byte == b')' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            text.push(byte as char);
        }
        text
    }

    fn hex(&mut self) -> Result<String, String> {
        self.pos += 1;
        let mut hex = String::new();
        while self.pos < self.bytes.len() && self.bytes[self.pos] != b'>' {
            let byte = self.bytes[self.pos];
            self.pos += 1;
            if !is_space(byte) {
                hex.push(byte as char);
            }
        }
        self.pos += 1;
        if hex.len() % 2 == 1 {
            hex.push('0');
        }
        let mut text = String::new();
        let chars: Vec<char> = hex.chars().collect();
        let mut at = 0;
        while at + 1 < chars.len() {
            let pair: String = chars[at..at + 2].iter().collect();
            let code = u32::from_str_radix(&pair, 16).map_err(|_| NO_READ.to_string())?;
            text.push(char::from_u32(code).ok_or_else(|| NO_READ.to_string())?);
            at += 2;
        }
        Ok(text)
    }

    fn raw_name(&mut self) -> String {
        self.pos += 1;
        let mut name = String::new();
        while self.pos < self.bytes.len() && !is_delim(self.bytes[self.pos]) {
            let byte = self.bytes[self.pos];
            self.pos += 1;
            if byte == b'#' {
                let pair = String::from_utf8_lossy(&self.bytes[self.pos..self.pos + 2]).to_string();
                self.pos += 2;
                if let Ok(code) = u8::from_str_radix(&pair, 16) {
                    name.push(code as char);
                }
            } else {
                name.push(byte as char);
            }
        }
        name
    }

    fn number(&mut self) -> Option<f64> {
        self.skip();
        let start = self.pos;
        if self.bytes.get(self.pos) == Some(&b'+') || self.bytes.get(self.pos) == Some(&b'-') {
            self.pos += 1;
        }
        let mut saw = false;
        while self.bytes.get(self.pos).is_some_and(|byte| byte.is_ascii_digit()) {
            saw = true;
            self.pos += 1;
        }
        if self.bytes.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            while self.bytes.get(self.pos).is_some_and(|byte| byte.is_ascii_digit()) {
                saw = true;
                self.pos += 1;
            }
        }
        if !saw {
            self.pos = start;
            return None;
        }
        std::str::from_utf8(&self.bytes[start..self.pos]).ok()?.parse().ok()
    }

    fn word(&mut self, word: &str) -> Result<(), String> {
        self.skip();
        if !self.starts(word) {
            return Err(NO_READ.to_string());
        }
        self.pos += word.len();
        Ok(())
    }

    fn keyword(&mut self, word: &str) -> bool {
        if self.starts(word) {
            let next = self.bytes.get(self.pos + word.len()).copied();
            if next.is_none_or(is_delim) {
                self.pos += word.len();
                return true;
            }
        }
        false
    }

    fn starts(&self, word: &str) -> bool {
        self.bytes[self.pos..].starts_with(word.as_bytes())
    }

    fn line(&mut self) -> String {
        let start = self.pos;
        while self.pos < self.bytes.len() && self.bytes[self.pos] != b'\n' && self.bytes[self.pos] != b'\r' {
            self.pos += 1;
        }
        if self.bytes.get(self.pos) == Some(&b'\r') {
            self.pos += 1;
        }
        if self.bytes.get(self.pos) == Some(&b'\n') {
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.bytes[start..self.pos]).to_string()
    }

    fn skip(&mut self) {
        loop {
            while self.bytes.get(self.pos).is_some_and(|byte| is_space(*byte)) {
                self.pos += 1;
            }
            if self.bytes.get(self.pos) != Some(&b'%') {
                return;
            }
            while self.pos < self.bytes.len() && self.bytes[self.pos] != b'\n' && self.bytes[self.pos] != b'\r' {
                self.pos += 1;
            }
        }
    }
}

fn name_of(value: Option<&Value>) -> Option<&str> {
    match value {
        Some(Value::Name(name)) => Some(name.as_str()),
        _ => None,
    }
}

fn ints(value: Option<&Value>) -> Vec<i64> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::Number(number) => Some(*number as i64),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn read_int(data: &[u8], at: usize, width: usize) -> u64 {
    let mut value = 0u64;
    for index in 0..width {
        value = (value << 8) | data[at + index] as u64;
    }
    value
}

fn is_space(byte: u8) -> bool {
    matches!(byte, 0 | 9 | 10 | 12 | 13 | 32)
}

fn is_delim(byte: u8) -> bool {
    is_space(byte) || matches!(byte, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

#[cfg(test)]
mod tests {
    use super::{page_count, unpredict};

    fn classic_pdf() -> Vec<u8> {
        let objects = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>\nendobj\n",
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>\nendobj\n",
            "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>\nendobj\n",
        ];
        let mut body = String::from("%PDF-1.4\n");
        let mut offsets = vec![0usize];
        for object in objects {
            offsets.push(body.len());
            body.push_str(object);
        }
        let xref_at = body.len();
        let mut xref = format!("xref\n0 {}\n", objects.len() + 1);
        xref.push_str("0000000000 65535 f \n");
        for index in 1..=objects.len() {
            xref.push_str(&format!("{:010} 00000 n \n", offsets[index]));
        }
        xref.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            objects.len() + 1
        ));
        body.push_str(&xref);
        body.into_bytes()
    }

    #[test]
    fn counts_a_classic_xref() {
        assert_eq!(page_count(&classic_pdf()).unwrap(), 2);
    }

    #[test]
    fn counts_one_page() {
        let bytes = include_bytes!("../fixtures/one-page.pdf");
        assert_eq!(page_count(bytes).unwrap(), 1);
    }

    #[test]
    fn counts_two_pages() {
        let bytes = include_bytes!("../fixtures/two-page.pdf");
        assert_eq!(page_count(bytes).unwrap(), 2);
    }

    #[test]
    fn rejects_empty_bytes() {
        assert!(page_count(&[]).is_err());
    }

    #[test]
    fn undoes_an_up_predictor() {
        let data = [2, 1, 2, 2, 1, 2];
        assert_eq!(unpredict(&data, 2).unwrap(), vec![1, 2, 2, 4]);
    }
}
