"""HSEOS local control v1 client; Python standard library only."""
import json
import re
import urllib.parse
import urllib.request
import urllib.error


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Control redirects are forbidden")


class ControlClient:
    def __init__(self, url, credential):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or len(credential) < 32):
            raise ValueError("A loopback control endpoint and credential are required")
        self._url = url.rstrip("/")
        self._credential = credential
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    def _request(self, route, body=None):
        request = urllib.request.Request(
            self._url + route,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={"Authorization": "Bearer " + self._credential,
                     "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=300) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            value = json.load(error)
            raise RuntimeError(value.get("error", "CONTROL_REQUEST_FAILED")) from None

    def prepare(self, contract):
        return self._request("/v1/prepare", contract)

    def execute(self, command):
        return self._request("/v1/commands", command)

    def query(self, resource_id, view="status"):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id) or view not in ("status", "evidence", "review", "session"):
            raise ValueError("Invalid control query")
        return self._request("/v1/tasks/" + resource_id + ("" if view == "status" else "/" + view))

    def events(self, resource_id, after=0, limit=100):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id) or type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid event cursor")
        return self._request("/v1/tasks/" + resource_id + "/events?" + urllib.parse.urlencode({"after": after, "limit": limit}))

    def terminal(self, command):
        return self._request("/v1/terminals/commands", command)

    def terminal_query(self, resource_id):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id):
            raise ValueError("Invalid terminal query")
        return self._request("/v1/terminals/" + resource_id)

    def terminal_events(self, resource_id, after=0, limit=100):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id) or type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid terminal cursor")
        return self._request("/v1/terminals/" + resource_id + "/events?" + urllib.parse.urlencode({"after": after, "limit": limit}))

    def campaign(self, command):
        return self._request("/v1/provider-campaigns/commands", command)

    def job(self, command):
        return self._request("/v1/jobs/commands", command)

    def job_query(self, resource_id):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id):
            raise ValueError("Invalid job query")
        return self._request("/v1/jobs/" + resource_id)

    def job_events(self, resource_id, after=0, limit=100):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id) or type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid job cursor")
        return self._request("/v1/jobs/" + resource_id + "/events?" + urllib.parse.urlencode({"after": after, "limit": limit}))

    def campaign_query(self, resource_id):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id):
            raise ValueError("Invalid campaign query")
        return self._request("/v1/provider-campaigns/" + resource_id)

    def campaign_events(self, resource_id, after=0, limit=100):
        if not re.fullmatch(r"[a-f0-9-]{36}", resource_id) or type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid campaign cursor")
        return self._request("/v1/provider-campaigns/" + resource_id + "/events?" + urllib.parse.urlencode({"after": after, "limit": limit}))

    def binding_inspect(self, binding_id):
        if not isinstance(binding_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]*:[a-z][a-z0-9-]*", binding_id):
            raise ValueError("Invalid binding identity")
        return self._request("/v1/provider-bindings?" + urllib.parse.urlencode({"binding_id": binding_id}))
