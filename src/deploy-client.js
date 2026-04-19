module.exports = {
  triggerDeploy,
};

async function triggerDeploy({
  branch,
  deployerUrl,
  logEvent,
  repository,
  timeoutMs,
}) {
  try {
    const response = await fetch(deployerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ branch, repository }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logEvent("deploy_trigger_failed", {
        status: response.status,
        deployerUrl,
        branch,
      });
      return false;
    }

    logEvent("deploy_triggered", {
      deployerUrl,
      branch,
    });
    return true;
  } catch (error) {
    logEvent("deploy_trigger_error", {
      message: error.message,
      deployerUrl,
      branch,
    });
    return false;
  }
}
