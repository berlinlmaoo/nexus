#!/usr/bin/env python3
"""Opt-in DEV contract smoke test; credentials stay in memory, temporary QA deal is deleted.

Uses ~/.config/nexus/{ios-dev-server-url,qa5-dev-password}, or NEXUS_QA_BASE / NEXUS_QA_PASSWORD.
Never run against production. Captured workbook files and a concise JSON result go to --out.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
config = Path.home() / '.config/nexus'
base = os.environ.get('NEXUS_QA_BASE') or (config / 'ios-dev-server-url').read_text().strip()
password = os.environ.get('NEXUS_QA_PASSWORD') or (config / 'qa5-dev-password').read_text().strip()
assert urllib.parse.urlparse(base).hostname not in ('nexus.znetworks.id', 'nexus-dev.invalid'), 'A reachable DEV host is required'
checks = []

def record(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS:', name, flush=True)

class Client:
    def __init__(self, email):
        self.cookie = None
        status, data = self.call('/api/auth/app-login', 'POST', {'email': email, 'password': password})
        assert status == 200, f'{email}: sign-in status {status}'
        self.cookie = data['cookieName'] + '=' + data['token']

    def call(self, path, method='GET', body=None, binary=False):
        headers = {'Content-Type': 'application/json'}
        if self.cookie:
            headers['Cookie'] = self.cookie
        req = urllib.request.Request(base + path, None if body is None else json.dumps(body).encode(), headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read()
                return response.status, raw if binary else json.loads(raw)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

bod = Client('qa5@dev.invalid')
manager = Client('qa2@dev.invalid')
for client, role in [(bod, 'BOD'), (manager, 'MANAGER')]:
    status, data = client.call('/api/workspaces/members')
    record(role + ' workspace role', status == 200 and data['role'] == role)
for endpoint in ['/api/pipelines/boards', '/api/pipelines/all', '/api/pipelines/all/export?lang=en']:
    status, data = manager.call(endpoint)
    record('Manager forbidden: ' + endpoint, status == 403 and data['code'] == 'ALL_PIPELINES_FORBIDDEN')
status, boards = bod.call('/api/pipelines/boards')
board_name = os.environ.get('NEXUS_QA_PIPELINE_BOARD')
assert board_name and 'QA' in board_name, 'Set NEXUS_QA_PIPELINE_BOARD to a DEV QA board'
board = next(x for x in boards['boards'] if x['name'] == board_name)
path = '/api/projects/' + board['id'] + '/pipeline'
deal_id = None
try:
    status, created = bod.call(path, 'POST', {'name': '[TEST] iOS v8 contract ' + datetime.datetime.now().isoformat(timespec='seconds'), 'brand': 'QA keep', 'mainDate': '2027-01-01', 'netValue': 100000000})
    record('Create isolated QA deal', status == 201 and bool(created.get('id')))
    deal_id = created['id']
    detail_path = path + '/' + deal_id
    request_id = str(uuid.uuid4())
    status, added = bod.call(detail_path + '/items', 'POST', {'kind': 'cashback', 'name': 'QA recipient', 'amount': 1500000, 'clientRequestId': request_id})
    record('Add cashback returns full deal', status == 201 and added['deal']['cashbackTotal'] == 1500000)
    cashback_id = added['item']['id']
    status, duplicate = bod.call(detail_path + '/items', 'POST', {'kind': 'cashback', 'name': 'QA recipient', 'amount': 1500000, 'clientRequestId': request_id})
    record('One request ID creates one row', status == 200 and duplicate['duplicate'] and duplicate['item']['id'] == cashback_id and len(duplicate['deal']['cashback']) == 1)
    status, contact = bod.call(detail_path + '/items', 'POST', {'kind': 'contact', 'role': 'PM (client side)', 'name': 'QA client PM', 'phone': '0812 QA', 'clientRequestId': str(uuid.uuid4())})
    record('Add project contact', status == 201 and contact['deal']['contacts'][0]['role'] == 'PM (client side)')
    status, budget = bod.call(detail_path + '/items', 'POST', {'kind': 'budget', 'name': 'QA venue', 'amount': 25000000, 'clientRequestId': str(uuid.uuid4())})
    record('Add budget category', status == 201 and budget['deal']['budgetTotal'] == 25000000)
    budget_id = budget['item']['id']
    costs = [{'id': 'qa_cost', 'label': 'QA venue cost', 'amount': 31000000, 'budgetId': budget_id}]
    status, updated = bod.call(detail_path, 'PATCH', {'costs': costs, 'costsBase': [], 'barterValue': 5000000, 'barterCompensation': '2 TV ad slots'})
    record('Budget overspend and margin', status == 200 and updated['budgets'][0]['remaining'] == -6000000 and updated['margin'] == 69000000)
    status, sparse = bod.call(detail_path, 'PATCH', {'notes': 'QA sparse edit'})
    record('Sparse patch preserves old and v8 fields', status == 200 and sparse['brand'] == 'QA keep' and sparse['barterValue'] == 5000000 and len(sparse['cashback']) == 1 and sparse['costs'][0]['budgetId'] == budget_id)
    cleared = [{**costs[0], 'budgetId': None}]
    status, updated = bod.call(detail_path, 'PATCH', {'costs': cleared, 'costsBase': costs})
    record('Explicit null clears cost category', status == 200 and updated['costs'][0]['budgetId'] is None and updated['budgets'][0]['spent'] == 0 and updated['margin'] == 69000000)
    status, negative = bod.call(detail_path + '/items/' + cashback_id, 'PATCH', {'amount': -1})
    record('Negative item amount rejected', status == 400 and negative['field'] == 'amount')
    status, contact_edited = bod.call(detail_path + '/items/' + contact['item']['id'], 'PATCH', {'phone': '0899 QA'})
    record('Contact single-field edit preserves name and role', status == 200 and contact_edited['item']['name'] == 'QA client PM' and contact_edited['item']['role'] == 'PM (client side)')
    status, deleted = bod.call(detail_path + '/items/' + cashback_id, 'DELETE')
    record('Delete item returns whole updated deal', status == 200 and deleted['deal']['cashback'] == [])
    status, board_year = bod.call(path + '?year=2027')
    record('Year filter and summary', status == 200 and board_year['year'] == 2027 and all(x['eventYear'] == 2027 for x in board_year['deals']) and deal_id in [x['id'] for x in board_year['deals']])
    status, combined = bod.call('/api/pipelines/all?source=' + board['id'] + '&year=2027')
    record('Combined source/year read-only', status == 200 and not combined['canEdit'] and all(x['source']['projectId'] == board['id'] and x['eventYear'] == 2027 for x in combined['deals']))
    expected = {
        'en': ['Barter Value', 'Barter Compensation Form', 'Total Cashback', 'Cashback Details', 'Project Contacts', 'Total Budget', 'Budget Details', 'Source', 'Event Year'],
        'id': ['Nilai Barter', 'Bentuk Kompensasi Barter', 'Total Cashback', 'Rincian Cashback', 'Kontak Project', 'Total Budget', 'Rincian Budget', 'Sumber', 'Tahun Event'],
    }
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for scope, export_path in [('board', path + '/export'), ('all', '/api/pipelines/all/export')]:
        for lang in ['en', 'id']:
            query = '?lang=' + lang + '&year=2027' + ('&source=' + board['id'] if scope == 'all' else '')
            status, data = bod.call(export_path + query, binary=True)
            record(scope + '/' + lang + ' export downloaded', status == 200 and isinstance(data, bytes))
            target = args.out / (scope + '-' + lang + '.xlsx')
            target.write_bytes(data)
            with zipfile.ZipFile(target) as z:
                strings = []
                if 'xl/sharedStrings.xml' in z.namelist():
                    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
                    strings = [''.join(x.itertext()) for x in root.findall('s:si', ns)]
                sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
                row = sheet.find('s:sheetData/s:row', ns)
                values = []
                for cell in row.findall('s:c', ns):
                    value = cell.find('s:v', ns)
                    if cell.get('t') == 's': values.append(strings[int(value.text)])
                    else: values.append(''.join(cell.find('s:is', ns).itertext()) if cell.find('s:is', ns) is not None else value.text if value is not None else '')
                record(scope + '/' + lang + ' 43 columns in contract order', len(values) == 43 and values[-9:] == expected[lang])
finally:
    if deal_id:
        status, _ = bod.call(path + '/' + deal_id, 'DELETE')
        record('Temporary QA deal cleaned up', status == 200)
    for client in [bod, manager]:
        client.call('/api/auth/app-logout', 'POST')
    (args.out / 'dev-contract-results.json').write_text(json.dumps({'checks': checks, 'passed': len(checks), 'temporaryDealCleaned': deal_id is not None}, indent=2))
print('Passed', len(checks), 'DEV checks')
