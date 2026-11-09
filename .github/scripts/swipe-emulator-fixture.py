#!/usr/bin/env python3
"""Native interaction check using a fake in-memory app session and synthetic API only."""
import os, re, subprocess, sys, time, xml.etree.ElementTree as ET
from pathlib import Path

ART = Path('/tmp/holup-swipe-fixture-artifacts'); ART.mkdir(exist_ok=True)

def adb(*args, check=True):
    return subprocess.run(['adb', *map(str,args)], check=check, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout

def ui():
    adb('shell','uiautomator','dump','/sdcard/fixture.xml')
    raw=adb('shell','cat','/sdcard/fixture.xml')
    (ART/'latest-ui.xml').write_text(raw)
    return ET.fromstring(raw[raw.index('<?xml'):])

def match(n, name):
    return n.get('text','') == name or n.get('content-desc','') == name

def wait_node(name, timeout=30):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        root=ui()
        hits=[n for n in root.iter('node') if match(n,name) and n.get('bounds')]
        if hits: return hits[0]
        time.sleep(1)
    raise AssertionError('Not found: '+name)

def wait_contains(text, timeout=20):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        root=ui()
        if any(text in n.get('text','') or text in n.get('content-desc','') for n in root.iter('node')): return
        time.sleep(1)
    raise AssertionError('Not shown: '+text)

def is_visible(text):
    root=ui()
    return any(text in n.get('text','') or text in n.get('content-desc','') for n in root.iter('node'))

def center(node):
    bounds=node.get('bounds','')
    m=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',bounds)
    if not m: raise AssertionError('Bad bounds: '+bounds)
    x1,y1,x2,y2=map(int,m.groups()); return ((x1+x2)//2,(y1+y2)//2)

def tap(name):
    x,y=center(wait_node(name)); adb('shell','input','tap',x,y); time.sleep(1.5)

def swipe(x1,y1,x2,y2):
    adb('shell','input','swipe',x1,y1,x2,y2,400); time.sleep(2)

try:
    wait_node('Crushes',90)
    dims=adb('shell','wm','size'); m=re.search(r'(\d+)x(\d+)',dims); assert m,dims
    w,h=map(int,m.groups()); print('Device dimensions',w,h,flush=True)
    # Horizontal page swipe over the feed, then reverse; the row remains tappable.
    swipe(int(w*.78),int(h*.44),int(w*.20),int(h*.44))
    wait_contains('From everyone')
    swipe(int(w*.20),int(h*.44),int(w*.78),int(h*.44))
    wait_contains('Offline test post')
    tap('Whispers')
    wait_node('Search conversations')
    swipe(int(w*.78),int(h*.44),int(w*.20),int(h*.44))
    wait_contains('People you’ve chosen to keep near')
    swipe(int(w*.20),int(h*.44),int(w*.78),int(h*.44))
    wait_node('Search conversations')
    tap('Home'); wait_node('Notifications'); tap('Notifications')
    wait_contains('Fixture Ada sent you a Whisper')
    wait_contains('Fixture Ada commented on your post')
    swipe(int(w*.78),int(h*.50),int(w*.20),int(h*.50))
    wait_contains('Fixture Ada sent you a Whisper')
    if is_visible('Fixture Ada commented on your post'): raise AssertionError('Notification category did not change')
    swipe(int(w*.78),int(h*.50),int(w*.20),int(h*.50))
    wait_contains('Fixture Ada commented on your post')
    yours=wait_node('Yours'); x,y=center(yours)
    swipe(min(w-30,x+int(w*.45)),y,max(20,x-int(w*.15)),y)
    wait_contains('No other updates from Holup')
    print('Native synthetic Home, Whispers, notification and category gestures passed.',flush=True)
except Exception as exc:
    print('TEST FAILED:',repr(exc),flush=True)
    try:
        ui()
        with (ART/'failure.png').open('wb') as f: subprocess.run(['adb','exec-out','screencap','-p'],stdout=f,check=True)
        adb('logcat','-d','-t','3000',check=False)
    except Exception as debug: print('Debug capture failed',repr(debug))
    sys.exit(1)
