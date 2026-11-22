import argparse
import json
import sys
from .core import PipelineError, init_project, build_project, check_project


def main(argv=None):
    parser = argparse.ArgumentParser(prog="spritepipe", description="Whole-character pixel asset workflow utilities")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ["init", "demo", "build", "check"]:
        p = sub.add_parser(command)
        p.add_argument("project", help="Local project directory")
        if command in ["build", "check"]: p.add_argument("--action", help="Build/check just one action ID")
        if command == "build": p.add_argument("--force", action="store_true", help="Archive prior output before replacement")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            init_project(args.project)
            result = {"status": "DRAFT", "next": "Add source PNG and edit profile.json; palette must be frozen."}
        elif args.command == "demo":
            init_project(args.project, demo=True)
            result = build_project(args.project)
        elif args.command == "build":
            result = build_project(args.project, args.action, args.force)
        else:
            result = check_project(args.project, args.action)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result["status"] == "FAIL" else 0
    except (PipelineError, OSError, ValueError) as e:
        print("spritepipe: " + str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
