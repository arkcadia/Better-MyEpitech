package eu.bettermyepitech.google

import android.accounts.Account
import android.app.Activity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Google owns consent UI and token caching. No passwords, refresh tokens or ID tokens cross this bridge. */
class BetterGoogleAuthModule : Module() {
  private var pending: Promise? = null
  private val requestCode = 49127
  private val scopes = listOf(
    Scope("https://www.googleapis.com/auth/calendar.app.created"),
    Scope("openid"),
    Scope("https://www.googleapis.com/auth/userinfo.email")
  )

  override fun definition() = ModuleDefinition {
    Name("BetterGoogleAuth")

    AsyncFunction("authorize") { email: String?, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_GOOGLE_SETUP", "An Android activity is required.", null)
      } else if (pending != null) {
        promise.reject("ERR_GOOGLE_BUSY", "A Google authorization is already running.", null)
      } else {
        pending = promise
        val request = AuthorizationRequest.builder().setRequestedScopes(scopes)
          .setOptOutIncludingGrantedScopes(true)
        if (email != null) request.setAccount(Account(email, "com.google"))
        else request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
        Identity.getAuthorizationClient(activity).authorize(request.build())
          .addOnSuccessListener { result ->
            if (pending !== promise) return@addOnSuccessListener
            if (result.hasResolution()) {
              val resolution = result.pendingIntent
              if (resolution == null) fail("ERR_GOOGLE_AUTHORIZATION")
              else {
                try {
                  // Expo forwards the activity result below. No custom browser
                  // callback, client secret or unsupported OAuth URI is involved.
                  @Suppress("DEPRECATION")
                  activity.startIntentSenderForResult(resolution.intentSender, requestCode, null, 0, 0, 0)
                } catch (_: Exception) { fail("ERR_GOOGLE_AUTHORIZATION") }
              }
            } else complete(result)
          }
          .addOnFailureListener { failure ->
            if (pending === promise) fail(if (failure is ApiException && failure.statusCode == CommonStatusCodes.CANCELED) "ERR_GOOGLE_CANCELLED" else "ERR_GOOGLE_AUTHORIZATION")
          }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { activity, payload ->
      if (payload.requestCode == requestCode && pending != null) {
        val data = payload.data
        if (payload.resultCode != Activity.RESULT_OK || data == null) fail("ERR_GOOGLE_CANCELLED")
        else {
          try { complete(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)) }
          catch (_: Exception) { fail("ERR_GOOGLE_AUTHORIZATION") }
        }
      }
    }

    OnActivityDestroys { fail("ERR_GOOGLE_CANCELLED") }
    OnDestroy { fail("ERR_GOOGLE_CANCELLED") }
  }

  private fun complete(result: AuthorizationResult) {
    val promise = pending ?: return
    pending = null
    val token = result.accessToken
    if (token.isNullOrBlank()) promise.reject("ERR_GOOGLE_AUTHORIZATION", "Google authorization did not return an access token.", null)
    else promise.resolve(mapOf("accessToken" to token, "scopes" to result.grantedScopes.map { it.scopeUri }))
  }

  private fun fail(code: String) {
    val promise = pending ?: return
    pending = null
    promise.reject(code, "Google authorization did not complete.", null)
  }
}
