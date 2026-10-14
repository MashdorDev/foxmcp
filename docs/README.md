# FoxMCP Documentation

This directory contains comprehensive documentation for the FoxMCP project.

## Documentation Files

### Core Documentation

#### [api-reference.md](api-reference.md)
Reference for all 51 MCP tools: parameters, real input, the optional `status` argument, errors, and usage examples.

#### [configuration.md](configuration.md)
Setup (asking Claude Code, the plugin, or `uvx`), several sessions on one browser, real input through WebDriver BiDi, the add-on's settings page, command-line options and environment variables.

#### [development.md](development.md)
Comprehensive development guide including setup, workflow, testing, debugging, and contribution guidelines.

#### [scripts.md](scripts.md)
Predefined scripts documentation. Learn how to create custom JavaScript automation scripts, security features, and best practices.

#### [architecture.md](architecture.md)
System architecture overview: the add-on's scripts, popup and settings page, the server and its BiDi client, data flow including real input, the security model, and extension points.

### Technical Documentation

#### [protocol.md](protocol.md)
WebSocket message protocol specification with complete JSON message formats, browser function definitions, and error codes.

#### [web-request-monitoring.md](web-request-monitoring.md)
The `requests.*` action family: capturing browser traffic, reading response bodies, and the monitoring lifecycle.

#### [tabs_list_schema.md](tabs_list_schema.md)
Response schema for `tabs.list`.

#### [files.md](files.md)
Project structure, with what each file does, including the Python package and the Claude Code plugin files.

#### [venv-setup.md](venv-setup.md)
Virtual environment setup instructions with package installation commands, verification steps, and development environment configuration.

## Quick Navigation

- **Getting Started**: See main [README.md](../README.md) for quick start guide, and [configuration.md](configuration.md#setup) for setup
- **API Reference**: See [protocol.md](protocol.md) for WebSocket message formats
- **Project Structure**: See [files.md](files.md) for complete file overview
- **Project Status & Roadmap**: Tracked in the docforge at `~/progm/claudebugzilla/proj_docs/foxmcp/HANDOFF.md`, not in this directory
- **Environment Setup**: See [venv-setup.md](venv-setup.md) for detailed setup
- **Testing**: See [../tests/README.md](../tests/README.md) for the suite layout and how to run it

## Keeping These Accurate

Verify claims against the code before writing them down. In August 2026 a sweep found
these files documenting command-line flags, HTTP endpoints, environment variables, and
`FoxMCPServer` keyword arguments that had never existed, the result of writing docs
from a plan rather than from the source.