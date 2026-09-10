#!/usr/bin/env python3
"""sdd -- the command line.

Bootstrap only: deliberately written in a syntax subset valid under Python 2.6+
as well as Python 3, so THIS file parses regardless of which interpreter reached
it. No f-strings, no type hints, no print()-as-statement ambiguity -- only
sys.stderr.write and string concatenation. _sdd_core.py assumes a modern
interpreter (tomllib, f-strings) and is never imported until the version check
below has already passed, because Python only compiles a module when it is
imported -- a bad interpreter never reaches that file at all.
"""
import sys
import os

MIN_VERSION = (3, 11)


def _fail(message):
    sys.stderr.write(message + "\n")
    sys.exit(1)


def main():
    if sys.version_info[0] < 3:
        _fail(
            "sdd needs Python 3.11 or newer; this interpreter is Python "
            + str(sys.version_info[0]) + "." + str(sys.version_info[1]) + ".\n"
            "Run it explicitly with python3 instead: python3 sdd.py " + " ".join(sys.argv[1:])
        )

    if sys.version_info < MIN_VERSION:
        _fail(
            "sdd needs Python 3.11 or newer; this is Python "
            + str(sys.version_info[0]) + "." + str(sys.version_info[1]) + ".\n"
            "Install a newer one, e.g.:\n"
            "  brew install python@3.13\n"
            "  pyenv install 3.13 && pyenv local 3.13"
        )

    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import _sdd_core

    sys.exit(_sdd_core.main(sys.argv[1:]))


if __name__ == "__main__":
    main()
