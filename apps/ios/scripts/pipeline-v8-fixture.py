#!/usr/bin/env python3
"""Prepare/clean isolated DEV screenshot deals so parallel QA cannot alter the reference fixture."""
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

action, manifest_path = sys.argv[1:]
manifest_path = Path(manifest_path)
config = Path.home() / '.config/nexus'
base = os.environ.get('NEXUS_QA_BASE') or (config / 'ios-dev-server-url').read_text().strip()
password = os.environ.get('TOUR_PASSWORD') or (config / 'qa5-dev-password').read_text().strip()
assert urllib.parse.urlparse(base).hostname not in ('nexus.znetworks.id', 'nexus-dev.invalid')
cookie = None

def call(path, method='GET', body=None):
    headers = {'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    request = urllib.request.Request(base + path, None if body is None else json.dumps(body).encode(), headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

session = call('/api/auth/app-login', 'POST', {'email': 'qa5@dev.invalid', 'password': password})
cookie = session['cookieName'] + '=' + session['token']
try:
    if action == 'prepare':
        boards = call('/api/pipelines/boards')['boards']
        board_name = os.environ.get('NEXUS_QA_PIPELINE_BOARD')
        assert board_name and 'QA' in board_name, 'Set NEXUS_QA_PIPELINE_BOARD to a DEV QA board accessible by qa5 and qa2'
        board = next(x for x in boards if x['name'] == board_name)
        pipeline = '/api/projects/' + board['id'] + '/pipeline'
        manifest = {'boardId': board['id'], 'boardName': board['name'], 'dealIds': []}
        def persist():
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(manifest, indent=2))
        for name, stage, key in [('[TEST] iOS v8 Festival', 'Won – In Execution', 'festivalId'), ('[TEST] iOS v8 No date', 'Incoming', 'emptyId')]:
            deal = call(pipeline, 'POST', {'name': name, 'stage': stage})
            manifest['dealIds'].append(deal['id'])
            manifest[key] = deal['id']
            persist()
        path = pipeline + '/' + manifest['festivalId']
        def add(kind, **fields):
            return call(path + '/items', 'POST', {'kind': kind, 'clientRequestId': str(uuid.uuid4()), **fields})['item']['id']
        add('cashback', name='Budi', amount=1500000)
        add('cashback', name='Sari', amount=500000)
        add('contact', role='Client', name='Andi', phone='0812-1111-2222')
        add('contact', role='PM (client side)', name='Rina', phone='0813-3333')
        venue = add('budget', name='Venue', amount=25000000)
        talent = add('budget', name='Talent', amount=15000000)
        call(path, 'PATCH', {'brand': 'iOS QA', 'netValue': 100000000, 'contractValue': 100000000,
                            'mainDate': '2026-11-02', 'barterValue': 5000000, 'barterCompensation': '2 slot iklan TV',
                            'costs': [{'id': 'c_venue', 'label': 'Sewa venue', 'amount': 31000000, 'budgetId': venue},
                                      {'id': 'c_talent', 'label': 'Talent fee', 'amount': 10000000, 'budgetId': talent},
                                      {'id': 'c_misc', 'label': 'Lain-lain', 'amount': 2000000, 'budgetId': None}], 'costsBase': []})
        print('Prepared isolated iOS screenshot deals')
    elif action == 'cleanup' and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for deal in manifest['dealIds']:
            try:
                call('/api/projects/' + manifest['boardId'] + '/pipeline/' + deal, 'DELETE')
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
        manifest['cleaned'] = True
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print('Cleaned isolated iOS screenshot deals')
    else:
        raise SystemExit('Expected prepare or cleanup')
finally:
    call('/api/auth/app-logout', 'POST')
